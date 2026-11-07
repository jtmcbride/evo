import { SimulationClient } from "./client";
import {
  defineExperiment,
  initialCheckpoint,
  type ExperimentCheckpoint,
} from "../core/evolution";
import { ExperimentRunner, type GenerationCommit } from "../core/experiment";
import { generateScenario } from "../core/world/scenario";
import type { CommandBody, PlaybackSnapshot } from "./protocol";
const client = new SimulationClient();
const records: GenerationCommit[] = [];
let scope: { experimentId: string; epoch: number } | null = null,
  playbackId: string | null = null,
  autoCommit = true,
  lastSnapshot: PlaybackSnapshot | null = null,
  serial = 0;
const element = (id: string) => document.getElementById(id)!;
const message = (text: string) => {
  element("messages").textContent = (
    text +
    "\n" +
    element("messages").textContent
  ).slice(0, 4000);
};
const showPlayback = (snapshot: PlaybackSnapshot) => {
  lastSnapshot = snapshot;
  element("playback").textContent = JSON.stringify(snapshot, null, 2);
};
client.subscribe((event) => {
  if (event.type === "status")
    element("status").textContent = JSON.stringify(event.status, null, 2);
  if (event.type === "reply" && event.data.type === "status")
    element("status").textContent = JSON.stringify(event.data.status, null, 2);
  if (event.type === "snapshot") showPlayback(event.snapshot);
  if (event.type === "reply" && event.data.type === "disposed")
    element("status").textContent = "Worker disposed.";
  if (event.type === "error") message(`${event.scope}: ${event.message}`);
  if (event.type === "generationCommit") {
    records.push(event.commit);
    if (records.length > 5) records.shift();
    message(
      `Generation ${event.commit.record.generation} complete: ${event.commit.id}`,
    );
    if (autoCommit)
      void client
        .request({
          type: "commitSucceeded",
          experimentId: event.experimentId!,
          epoch: event.epoch,
          commitId: event.commit.id,
        })
        .catch((error) => message(String(error)));
  }
});
function requiredScope() {
  if (!scope) throw new Error("Initialize an experiment first");
  return scope;
}
function requiredPlayback() {
  if (!playbackId) throw new Error("Open a trial first");
  return playbackId;
}
const harness = {
  client,
  async initialize(
    options: { population?: number; ticks?: number; seed?: string } = {},
  ) {
    const d = defineExperiment(options.seed ?? "browser-m4");
    if (options.population) {
      d.evolution.population = options.population;
      d.evolution.elites = Math.min(4, options.population);
      d.evolution.immigrants = Math.min(
        8,
        options.population - d.evolution.elites,
      );
    }
    if (options.ticks) d.world.maxTicks = options.ticks;
    const checkpoint = initialCheckpoint(d),
      reply = await client.request({ type: "initialize", checkpoint });
    if (reply.type !== "status") throw new Error("Unexpected initialize reply");
    scope = { experimentId: d.id, epoch: reply.status.epoch };
    playbackId = null;
    lastSnapshot = null;
    element("playback").textContent = "No trial selected.";
    records.length = 0;
    return checkpoint;
  },
  start(generations = 1) {
    return client.request({
      type: "startTraining",
      ...requiredScope(),
      generations,
    });
  },
  pause() {
    return client.request({ type: "pauseTraining", ...requiredScope() });
  },
  async checkpoint(mode: "latest" | "afterGeneration" = "latest") {
    const reply = await client.request({
      type: "requestCheckpoint",
      ...requiredScope(),
      mode,
    });
    if (reply.type !== "checkpoint")
      throw new Error("Unexpected checkpoint reply");
    return reply.checkpoint;
  },
  async open() {
    const checkpoint = await harness.checkpoint();
    const genome = checkpoint.population[0];
    playbackId = `playback-${++serial}`;
    const reply = await client.request({
      type: "openPlayback",
      playbackId,
      definition: {
        scenario: generateScenario(
          "browser-playback",
          checkpoint.definition.world,
        ),
        controller: {
          kind: "neural",
          id: genome.id,
          parameters: genome.parameters,
        },
      },
    });
    if (reply.type === "playback") showPlayback(reply.snapshot);
    return playbackId;
  },
  async playback(
    command: "play" | "pause" | "tick" | "decision" | "inspect" | "seek",
    tick = 0,
  ) {
    const id = requiredPlayback();
    let body: CommandBody;
    if (command === "play" || command === "pause")
      body = {
        type: "setPlaybackState",
        playbackId: id,
        playing: command === "play",
        speed: 1,
      };
    else if (command === "tick" || command === "decision")
      body = { type: "stepPlayback", playbackId: id, mode: command };
    else if (command === "inspect")
      body = { type: "inspectPlayback", playbackId: id };
    else body = { type: "seekPlayback", playbackId: id, tick };
    const reply = await client.request(body);
    if (reply.type === "playback") showPlayback(reply.snapshot);
    return reply;
  },
  setAutoCommit(value: boolean) {
    autoCommit = value;
  },
  async acknowledge(commitId: string, success = true) {
    return client.request(
      success
        ? { type: "commitSucceeded", ...requiredScope(), commitId }
        : {
            type: "commitFailed",
            ...requiredScope(),
            commitId,
            message: "Injected save failure",
          },
    );
  },
  commits() {
    return structuredClone(records);
  },
  snapshot() {
    return structuredClone(lastSnapshot);
  },
  reference(checkpoint: ExperimentCheckpoint) {
    const runner = new ExperimentRunner(checkpoint);
    while (runner.phase !== "awaitingCommit") runner.advance(10000);
    return runner.pendingCommit()!;
  },
  dispose() {
    return client.request({ type: "dispose" });
  },
};
export type RuntimeHarness = typeof harness;
declare global {
  interface Window {
    m4: RuntimeHarness;
  }
}
window.m4 = harness;
const action = (id: string, fn: () => Promise<unknown>) =>
  element(id).addEventListener("click", () => {
    void fn().catch((error) => message(String(error)));
  });
element("setup").addEventListener("submit", (event) => {
  event.preventDefault();
  void harness
    .initialize({
      population: Number((element("population") as HTMLInputElement).value),
    })
    .catch((error) => message(String(error)));
});
action("train", () => harness.start());
action("pause", () => harness.pause());
action("checkpoint", async () => {
  const cp = await harness.checkpoint();
  message(`Saved population ready for generation ${cp.generation}`);
});
action("open", () => harness.open());
action("play", () => harness.playback("play"));
action("stop", () => harness.playback("pause"));
action("step", () => harness.playback("decision"));
action("inspect", () => harness.playback("inspect"));
action("dispose", () => harness.dispose());
element("seek-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void harness
    .playback("seek", Number((element("seek") as HTMLInputElement).value))
    .catch((error) => message(String(error)));
});
let heartbeat = 0;
const timer = setInterval(() => {
  element("heartbeat").textContent = `Page heartbeat ${++heartbeat}`;
}, 100);
window.addEventListener("pagehide", () => {
  clearInterval(timer);
  client.close();
});
void client.ready
  .then(() => {
    element("status").textContent = "Worker ready. Initialize an experiment.";
  })
  .catch((error) => message(String(error)));
