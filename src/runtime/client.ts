import {
  PROTOCOL_VERSION,
  isRuntimeEvent,
  type CommandBody,
  type RuntimeEvent,
  type ReplyData,
  type RuntimeStatus,
} from "./protocol";
export type RequestBody = Exclude<
  CommandBody,
  { type: "snapshotReceived" | "cancelRequest" }
>;
interface Pending {
  resolve: (data: ReplyData) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
/** Owns exactly one worker session. Generation commits are acknowledged by the caller after saving. */
export class SimulationClient {
  readonly ready: Promise<string>;
  private resolveReady!: (session: string) => void;
  private rejectReady!: (error: Error) => void;
  private session: string | null = null;
  private sequence = 0;
  private requestId = 0;
  private pending = new Map<string, Pending>();
  private listeners = new Set<(event: RuntimeEvent) => void>();
  private closed = false;
  private queued = 0;
  private wantedPlayback: string | null = null;
  private latestStatus: RuntimeStatus | null = null;
  private bootTimer: ReturnType<typeof setTimeout>;
  constructor(
    private worker: Worker = new Worker(
      new URL("./simulation.worker.ts", import.meta.url),
      { type: "module" },
    ),
    private timeoutMs = 30000,
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.ready.catch(() => {});
    this.bootTimer = setTimeout(
      () => this.fail(new Error("Worker startup timed out")),
      timeoutMs,
    );
    worker.addEventListener("message", this.onMessage);
    worker.addEventListener("error", this.onError);
    worker.addEventListener("messageerror", this.onMessageError);
  }
  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  status(): RuntimeStatus | null {
    return structuredClone(this.latestStatus);
  }
  private post(command: CommandBody, requestId: string) {
    this.worker.postMessage({
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.session,
      requestId,
      command,
    });
  }
  async request(command: RequestBody): Promise<ReplyData> {
    if (this.closed) throw new Error("Worker client closed");
    if (this.queued >= 64) throw new Error("Too many pending worker requests");
    this.queued++;
    const previous = this.wantedPlayback;
    if (command.type === "openPlayback")
      this.wantedPlayback = command.playbackId;
    else if (command.type === "initialize") this.wantedPlayback = null;
    try {
      await this.ready;
      if (this.closed) throw new Error("Worker client closed");
      const id = `request-${++this.requestId}`;
      return await new Promise<ReplyData>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          try {
            this.post(
              { type: "cancelRequest", targetRequestId: id },
              `cancel-${id}`,
            );
          } catch {
            /* The original timeout remains the actionable error. */
          }
          reject(new Error(`Worker request timed out: ${command.type}`));
        }, this.timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        try {
          this.post(command, id);
        } catch (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    } catch (error) {
      if (
        command.type === "openPlayback" &&
        this.wantedPlayback === command.playbackId
      )
        this.wantedPlayback = previous;
      throw error;
    } finally {
      this.queued--;
    }
  }
  private onMessage = (message: MessageEvent<unknown>) => {
    const event = message.data;
    if (!isRuntimeEvent(event)) return;
    if (event.type === "ready") {
      if (this.session || this.closed) return;
      this.session = event.sessionId;
      this.sequence = event.sequence;
      clearTimeout(this.bootTimer);
      this.resolveReady(event.sessionId);
      return;
    }
    if (
      this.closed ||
      event.sessionId !== this.session ||
      event.sequence <= this.sequence
    )
      return;
    this.sequence = event.sequence;
    if (event.type === "status")
      this.latestStatus = structuredClone(event.status);
    if (event.type === "reply") {
      const pending = this.pending.get(event.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(event.requestId);
        if (
          event.data.type === "playback" &&
          event.data.snapshot.playbackId !== this.wantedPlayback
        )
          pending.reject(new Error("Stale playback reply"));
        else {
          if (event.data.type === "status")
            this.latestStatus = structuredClone(event.data.status);
          pending.resolve(event.data);
        }
      }
    }
    if (event.type === "error" && event.requestId) {
      const pending = this.pending.get(event.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(event.requestId);
        pending.reject(new Error(`${event.code}: ${event.message}`));
      }
    }
    // Receipt is independent of observers so a slow or throwing renderer cannot stall the worker.
    if (event.type === "snapshot") {
      try {
        if (event.snapshot.playbackId === this.wantedPlayback)
          this.notify(event);
      } finally {
        try {
          this.post(
            { type: "snapshotReceived", frameId: event.frameId },
            `frame-${event.frameId}`,
          );
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        }
      }
      return;
    }
    this.notify(event);
    if (event.type === "reply" && event.data.type === "disposed") this.close();
  };
  private notify(event: RuntimeEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Worker observer failed", error);
      }
    }
  }
  private onError = (event: ErrorEvent) =>
    this.fail(new Error(event.message || "Worker execution failed"));
  private onMessageError = () =>
    this.fail(new Error("Worker message could not be decoded"));
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.bootTimer);
    this.rejectReady(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.listeners.clear();
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onError);
    this.worker.removeEventListener("messageerror", this.onMessageError);
    this.worker.terminate();
  }
  close() {
    this.fail(new Error("Worker client closed"));
  }
}
