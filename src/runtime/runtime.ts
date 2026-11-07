import { ExperimentRunner } from "../core/experiment";
import {
  createEpisode,
  restoreEpisode,
  type EpisodeRunner,
  type EpisodeCheckpoint,
  type EpisodeDefinition,
} from "../core/episode";
import {
  commandSchema,
  PROTOCOL_VERSION,
  type Command,
  type EventPayload,
  type RuntimeEvent,
  type RuntimeStatus,
  type ReplyData,
  type PlaybackSnapshot,
} from "./protocol";

interface Playback {
  id: string;
  definition: EpisodeDefinition;
  runner: EpisodeRunner;
  playing: boolean;
  speed: number;
  debt: number;
  lastTime: number;
  cache: Map<number, EpisodeCheckpoint>;
  seek: { requestId: string; target: number } | null;
}
/** One worker owns this runtime. A pump is bounded by wall time; numerical work uses fixed ticks only. */
export class SimulationRuntime {
  private runner: ExperimentRunner | null = null;
  private experimentId: string | null = null;
  private epoch = 0;
  private sequence = 0;
  private runRequested = false;
  private target: number | null = null;
  private publishedCommit: string | null = null;
  private acknowledgedCommit: string | null = null;
  private playback: Playback | null = null;
  private disposed = false;
  private lastStatus = -Infinity;
  private lastFrame = -Infinity;
  private frameDirty = false;
  private frameId = 0;
  private inFlight: number | null = null;
  private checkpointRequest: string | null = null;
  constructor(
    readonly sessionId: string,
    private emit: (event: RuntimeEvent) => void,
    private now: () => number,
  ) {
    this.send({ type: "ready" });
  }
  private send(event: EventPayload) {
    this.emit({
      ...event,
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      experimentId: this.experimentId,
      epoch: this.epoch,
    } as RuntimeEvent);
  }
  status(): RuntimeStatus {
    const progress = this.runner?.progress();
    return {
      experimentId: this.experimentId,
      epoch: this.epoch,
      phase: this.runner?.phase ?? null,
      generation: progress?.generation ?? null,
      completedTrials: progress?.completedTrials ?? 0,
      totalTrials: progress?.totalTrials ?? 0,
      activeTick: progress?.activeTick ?? null,
      training:
        (this.runRequested || !!this.checkpointRequest) &&
        this.runner?.phase !== "awaitingCommit",
      targetGeneration: this.target,
      playbackId: this.playback?.id ?? null,
      playing: this.playback?.playing ?? false,
      seeking: !!this.playback?.seek,
      disposed: this.disposed,
    };
  }
  private reply(requestId: string, data: ReplyData) {
    this.send({ type: "reply", requestId, data });
  }
  private error(
    requestId: string | null,
    scope: "command" | "training" | "playback",
    code: string,
    error: unknown,
  ) {
    this.send({
      type: "error",
      requestId,
      scope,
      code,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  private cancelCheckpoint(message: string) {
    if (this.checkpointRequest) {
      this.error(this.checkpointRequest, "command", "CANCELLED", message);
      this.checkpointRequest = null;
    }
  }
  private cancelSeek(message: string) {
    if (this.playback?.seek) {
      this.error(this.playback.seek.requestId, "command", "CANCELLED", message);
      this.playback.seek = null;
    }
  }
  private requirePlayback(id: string): Playback {
    if (!this.playback || this.playback.id !== id)
      throw new Error("Stale playback");
    return this.playback;
  }
  private snapshot(): PlaybackSnapshot {
    const p = this.playback!;
    return {
      playbackId: p.id,
      state: p.runner.inspect(),
      decision: p.runner.decisionTrace(),
      result: p.runner.result(),
    };
  }
  receive(value: unknown): void {
    // Old sessions cannot change this runtime or receive replies belonging to the new session.
    if (
      value &&
      typeof value === "object" &&
      "sessionId" in value &&
      value.sessionId !== this.sessionId
    )
      return;
    const parsed = commandSchema.safeParse(value);
    if (!parsed.success) {
      const requestId =
        value &&
        typeof value === "object" &&
        "requestId" in value &&
        typeof value.requestId === "string"
          ? value.requestId
          : null;
      this.error(
        requestId,
        "command",
        "INVALID_COMMAND",
        "Invalid worker command",
      );
      return;
    }
    const message = parsed.data,
      command = message.command;
    try {
      if (this.disposed) throw new Error("Runtime disposed");
      if (
        "experimentId" in command &&
        (command.experimentId !== this.experimentId ||
          command.epoch !== this.epoch ||
          !this.runner)
      )
        throw new Error("Stale experiment");
      this.handle(message);
    } catch (error) {
      this.error(message.requestId, "command", "COMMAND_FAILED", error);
    }
  }
  private handle({ requestId, command: c }: Command) {
    switch (c.type) {
      case "initialize": {
        const runner = new ExperimentRunner(c.checkpoint);
        this.cancelCheckpoint("Experiment replaced");
        this.cancelSeek("Experiment replaced");
        this.runner = runner;
        this.experimentId = c.checkpoint.definition.id;
        this.epoch++;
        this.runRequested = false;
        this.target = null;
        this.publishedCommit = null;
        this.acknowledgedCommit = null;
        this.playback = null;
        this.inFlight = null;
        break;
      }
      case "startTraining":
        if (
          this.runner!.phase === "error" ||
          this.runner!.phase === "awaitingCommit"
        )
          throw new Error(
            "Training requires a healthy, acknowledged checkpoint",
          );
        this.target = this.runner!.progress().generation + c.generations;
        this.runRequested = true;
        break;
      case "pauseTraining":
        this.runRequested = false;
        this.cancelCheckpoint("Checkpoint completion cancelled by pause");
        break;
      case "commitSucceeded": {
        if (c.commitId === this.acknowledgedCommit) break;
        const commit = this.runner!.pendingCommit();
        if (!commit || commit.id !== c.commitId)
          throw new Error("Stale commit");
        this.runner!.acknowledge(c.commitId);
        this.acknowledgedCommit = c.commitId;
        this.publishedCommit = null;
        if (this.checkpointRequest) {
          this.reply(this.checkpointRequest, {
            type: "checkpoint",
            checkpoint: this.runner!.checkpoint(),
          });
          this.checkpointRequest = null;
          this.runRequested = false;
        }
        if (
          this.target !== null &&
          this.runner!.progress().generation >= this.target
        )
          this.runRequested = false;
        break;
      }
      case "commitFailed": {
        if (this.runner!.pendingCommit()?.id !== c.commitId)
          throw new Error("Stale commit");
        this.runRequested = false;
        this.cancelCheckpoint(`Commit failed: ${c.message}`);
        break;
      }
      case "requestCheckpoint":
        if (c.mode === "latest" || this.runner!.phase === "readyToEvaluate") {
          this.reply(requestId, {
            type: "checkpoint",
            checkpoint: this.runner!.checkpoint(),
          });
          return;
        }
        if (this.runner!.phase === "error")
          throw new Error("Cannot finish failed generation");
        if (this.checkpointRequest)
          throw new Error("A checkpoint request is already pending");
        this.checkpointRequest = requestId;
        return;
      case "openPlayback": {
        const definition = { ...c.definition, trace: true },
          runner = createEpisode(definition);
        this.cancelSeek("Playback replaced");
        this.playback = {
          id: c.playbackId,
          definition,
          runner,
          playing: false,
          speed: 1,
          debt: 0,
          lastTime: this.now(),
          cache: new Map([[0, runner.checkpoint()]]),
          seek: null,
        };
        this.inFlight = null;
        this.frameDirty = true;
        this.reply(requestId, { type: "playback", snapshot: this.snapshot() });
        this.publishFrame(true);
        this.publishStatus();
        return;
      }
      case "setPlaybackState": {
        const p = this.requirePlayback(c.playbackId);
        if (!c.playing) this.cancelSeek("Seek cancelled by pause");
        else if (p.seek) throw new Error("Seek is in progress");
        p.playing = c.playing && !p.runner.result();
        p.speed = c.speed;
        p.lastTime = this.now();
        break;
      }
      case "stepPlayback": {
        const p = this.requirePlayback(c.playbackId);
        if (p.playing || p.seek)
          throw new Error("Pause playback before stepping");
        const tick = p.runner.inspect().tick;
        this.advancePlayback(
          c.mode === "tick" ? 1 : tick % 3 === 0 ? 1 : 4 - (tick % 3),
        );
        this.reply(requestId, { type: "playback", snapshot: this.snapshot() });
        this.publishFrame(true);
        return;
      }
      case "inspectPlayback":
        this.requirePlayback(c.playbackId);
        this.reply(requestId, { type: "playback", snapshot: this.snapshot() });
        return;
      case "seekPlayback": {
        const p = this.requirePlayback(c.playbackId);
        if (c.tick > p.definition.scenario.config.maxTicks)
          throw new Error("Seek exceeds episode limit");
        this.cancelSeek("Seek replaced");
        const preceding = Math.max(
          ...Array.from(p.cache.keys()).filter((t) => t <= c.tick),
        );
        p.runner = restoreEpisode(p.cache.get(preceding)!);
        this.frameDirty = true;
        p.playing = false;
        p.debt = 0;
        p.seek = { requestId, target: c.tick };
        this.publishStatus();
        return;
      }
      case "snapshotReceived":
        if (this.inFlight === c.frameId) {
          this.inFlight = null;
          this.publishFrame(true);
        }
        return;
      case "cancelRequest":
        if (this.checkpointRequest === c.targetRequestId)
          this.cancelCheckpoint("Request cancelled");
        if (this.playback?.seek?.requestId === c.targetRequestId)
          this.cancelSeek("Request cancelled");
        this.publishStatus();
        return;
      case "dispose":
        this.cancelCheckpoint("Runtime disposed");
        this.cancelSeek("Runtime disposed");
        this.runRequested = false;
        this.playback = null;
        this.runner = null;
        this.disposed = true;
        this.reply(requestId, { type: "disposed" });
        return;
    }
    this.reply(requestId, { type: "status", status: this.status() });
    this.publishStatus();
  }
  private advancePlayback(ticks: number): number {
    const p = this.playback!;
    let count = 0;
    while (count < ticks && !p.runner.result()) {
      count += p.runner.advance(1).advancedTicks;
      this.frameDirty = true;
      const tick = p.runner.inspect().tick;
      if (tick % 30 === 0) {
        p.cache.set(tick, p.runner.checkpoint());
        if (p.cache.size > 128) {
          const key = Array.from(p.cache.keys()).find((t) => t !== 0)!;
          p.cache.delete(key);
        }
      }
    }
    if (p.runner.result() && p.playing) {
      p.playing = false;
      this.publishStatus();
    }
    return count;
  }
  private publishFrame(force = false) {
    if (
      !this.playback ||
      !this.frameDirty ||
      this.inFlight !== null ||
      (!force && this.now() - this.lastFrame < 50)
    )
      return;
    this.frameDirty = false;
    this.inFlight = ++this.frameId;
    this.lastFrame = this.now();
    this.send({
      type: "snapshot",
      frameId: this.frameId,
      snapshot: this.snapshot(),
    });
  }
  private publishStatus() {
    this.lastStatus = this.now();
    this.send({ type: "status", status: this.status() });
  }
  get needsWork(): boolean {
    return (
      !this.disposed &&
      !!(
        (this.runner &&
          (this.runRequested || this.checkpointRequest) &&
          this.runner.phase !== "awaitingCommit" &&
          this.runner.phase !== "error") ||
        this.playback?.playing ||
        this.playback?.seek
      )
    );
  }
  get hasTrainingWork(): boolean {
    return (
      !!this.runner &&
      (this.runRequested || !!this.checkpointRequest) &&
      this.runner.phase !== "awaitingCommit" &&
      this.runner.phase !== "error"
    );
  }
  /** The host must yield a real task between pumps to service worker messages. */
  pump(): void {
    if (this.disposed) return;
    const deadline = this.now() + 8,
      p = this.playback;
    if (p) {
      try {
        if (p.seek) {
          while (
            this.now() < deadline &&
            p.runner.inspect().tick < p.seek.target &&
            !p.runner.result()
          )
            this.advancePlayback(
              Math.min(16, p.seek.target - p.runner.inspect().tick),
            );
          if (p.runner.inspect().tick >= p.seek.target || p.runner.result()) {
            const request = p.seek.requestId;
            p.seek = null;
            this.reply(request, {
              type: "playback",
              snapshot: this.snapshot(),
            });
            this.publishFrame(true);
            this.publishStatus();
          }
        } else if (p.playing) {
          const time = this.now();
          p.debt += (Math.max(0, time - p.lastTime) * 30 * p.speed) / 1000;
          p.lastTime = time;
          while (p.debt >= 1 && this.now() < deadline && p.playing) {
            const count = this.advancePlayback(
              Math.min(16, Math.floor(p.debt)),
            );
            p.debt -= count;
          }
        }
      } catch (error) {
        if (p.seek) {
          this.error(p.seek.requestId, "command", "PLAYBACK_FAILED", error);
          p.seek = null;
        }
        p.playing = false;
        this.error(null, "playback", "PLAYBACK_FAILED", error);
        this.publishStatus();
      }
    }
    if (this.hasTrainingWork) {
      try {
        while (this.now() < deadline && this.hasTrainingWork) {
          this.runner!.advance(32);
          if (this.runner!.phase === "awaitingCommit") {
            const commit = this.runner!.pendingCommit()!;
            if (this.publishedCommit !== commit.id) {
              this.publishedCommit = commit.id;
              this.send({ type: "generationCommit", commit });
              this.publishStatus();
            }
          }
        }
      } catch (error) {
        this.runRequested = false;
        this.cancelCheckpoint("Training failed");
        this.error(null, "training", "TRAINING_FAILED", error);
        this.publishStatus();
      }
    }
    this.publishFrame();
    if (this.now() - this.lastStatus >= 250) this.publishStatus();
  }
}
