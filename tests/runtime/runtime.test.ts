import { test, expect } from "vitest";
import { SimulationRuntime } from "../../src/runtime/runtime";
import type { CommandBody, RuntimeEvent } from "../../src/runtime/protocol";
import { defineExperiment, initialCheckpoint } from "../../src/core/evolution";
import { ExperimentRunner } from "../../src/core/experiment";
import { generateScenario } from "../../src/core/world/scenario";
import { createEpisode } from "../../src/core/episode";
function setup() {
  const d = defineExperiment("runtime");
  Object.assign(d.evolution, {
    population: 8,
    elites: 2,
    immigrants: 1,
    trials: 2,
    validationInterval: 1,
    validationTrials: 2,
  });
  d.world.maxTicks = 90;
  const checkpoint = initialCheckpoint(d),
    events: RuntimeEvent[] = [];
  let time = 0,
    id = 0;
  const runtime = new SimulationRuntime(
    "session",
    (e) => events.push(structuredClone(e)),
    () => (time += 0.02),
  );
  const send = (command: CommandBody) => {
    const requestId = `r${++id}`;
    runtime.receive({
      protocolVersion: 1,
      sessionId: "session",
      requestId,
      command,
    });
    return requestId;
  };
  send({ type: "initialize", checkpoint });
  const scope = { experimentId: d.id, epoch: 1 };
  const playback = {
    scenario: generateScenario("playback", d.world),
    controller: { kind: "scripted" as const, id: "scripted-v1" },
  };
  const until = (check: () => boolean) => {
    for (let i = 0; i < 1000 && !check(); i++) runtime.pump();
    expect(check()).toBe(true);
  };
  return {
    runtime,
    events,
    checkpoint,
    scope,
    send,
    playback,
    until,
    elapse: (ms: number) => {
      time += ms;
    },
  };
}
function commits(events: RuntimeEvent[]) {
  return events.filter((e) => e.type === "generationCommit");
}
test("training matches core with independent inspection, stepping and seeking", () => {
  const h = setup(),
    baseline = new ExperimentRunner(h.checkpoint);
  while (baseline.phase !== "awaitingCommit") baseline.advance(10000);
  h.send({ type: "openPlayback", playbackId: "p", definition: h.playback });
  h.send({ type: "stepPlayback", playbackId: "p", mode: "tick" });
  h.send({ type: "inspectPlayback", playbackId: "p" });
  const decision = h.send({
    type: "stepPlayback",
    playbackId: "p",
    mode: "decision",
  });
  const reply = h.events.find(
    (e) => e.type === "reply" && e.requestId === decision,
  );
  expect(
    reply?.type === "reply" &&
      reply.data.type === "playback" &&
      reply.data.snapshot.decision?.tick,
  ).toBe(3);
  const seek = h.send({ type: "seekPlayback", playbackId: "p", tick: 17 });
  h.send({ type: "startTraining", ...h.scope, generations: 1 });
  h.until(() => commits(h.events).length === 1);
  expect(commits(h.events)[0].commit).toEqual(baseline.pendingCommit());
  h.until(() =>
    h.events.some((e) => e.type === "reply" && e.requestId === seek),
  );
  const expected = createEpisode({ ...h.playback, trace: true });
  expected.advance(17);
  const result = h.events.find(
    (e) => e.type === "reply" && e.requestId === seek,
  );
  expect(
    result?.type === "reply" && result.data.type === "playback"
      ? result.data.snapshot.state
      : null,
  ).toEqual(expected.inspect());
  expect(h.runtime.status().phase).toBe("awaitingCommit");
  h.runtime.pump();
  expect(commits(h.events)).toHaveLength(1);
  h.send({
    type: "commitSucceeded",
    ...h.scope,
    commitId: commits(h.events)[0].commit.id,
  });
  expect(h.runtime.status().generation).toBe(1);
  expect(h.runtime.needsWork).toBe(false);
});
test("pause and checkpoint barriers preserve pending commits and handle failed saves", () => {
  const h = setup();
  h.send({ type: "startTraining", ...h.scope, generations: 2 });
  h.send({ type: "pauseTraining", ...h.scope });
  expect(h.runtime.needsWork).toBe(false);
  h.send({ type: "startTraining", ...h.scope, generations: 2 });
  h.until(() => commits(h.events).length === 1);
  const request = h.send({
      type: "requestCheckpoint",
      ...h.scope,
      mode: "afterGeneration",
    }),
    id = commits(h.events)[0].commit.id;
  h.send({ type: "commitFailed", ...h.scope, commitId: id, message: "quota" });
  expect(
    h.events.some((e) => e.type === "error" && e.requestId === request),
  ).toBe(true);
  expect(h.runtime.status().generation).toBe(0);
  expect(h.runtime.needsWork).toBe(false);
  const retry = h.send({
    type: "requestCheckpoint",
    ...h.scope,
    mode: "afterGeneration",
  });
  h.send({ type: "commitSucceeded", ...h.scope, commitId: id });
  expect(
    h.events.some(
      (e) =>
        e.type === "reply" &&
        e.requestId === retry &&
        e.data.type === "checkpoint" &&
        e.data.checkpoint.generation === 1,
    ),
  ).toBe(true);
  expect(h.runtime.needsWork).toBe(false);
});
test("frames have one-in-flight backpressure while inspection replies remain reliable", () => {
  const h = setup();
  h.send({ type: "openPlayback", playbackId: "p", definition: h.playback });
  h.send({
    type: "setPlaybackState",
    playbackId: "p",
    playing: true,
    speed: 4,
  });
  for (let i = 0; i < 20; i++) {
    h.elapse(50);
    h.runtime.pump();
  }
  let frames = h.events.filter((e) => e.type === "snapshot");
  expect(frames).toHaveLength(1);
  const inspect = h.send({ type: "inspectPlayback", playbackId: "p" });
  expect(
    h.events.some(
      (e) =>
        e.type === "reply" &&
        e.requestId === inspect &&
        e.data.type === "playback" &&
        e.data.snapshot.state.tick > 0,
    ),
  ).toBe(true);
  h.send({ type: "snapshotReceived", frameId: frames[0].frameId });
  h.elapse(100);
  h.runtime.pump();
  frames = h.events.filter((e) => e.type === "snapshot");
  expect(frames).toHaveLength(2);
  expect(frames[1].snapshot.state.tick).toBeGreaterThan(
    frames[0].snapshot.state.tick,
  );
  h.send({ type: "snapshotReceived", frameId: frames[0].frameId });
  h.runtime.pump();
  expect(h.events.filter((e) => e.type === "snapshot")).toHaveLength(2);
});
test("replacement, stale epochs, cancellation and dispose settle deferred requests", () => {
  const h = setup();
  h.send({ type: "openPlayback", playbackId: "old", definition: h.playback });
  const seek = h.send({ type: "seekPlayback", playbackId: "old", tick: 80 });
  h.send({ type: "openPlayback", playbackId: "new", definition: h.playback });
  expect(
    h.events.some(
      (e) =>
        e.type === "error" && e.requestId === seek && e.code === "CANCELLED",
    ),
  ).toBe(true);
  h.send({ type: "initialize", checkpoint: h.checkpoint });
  const stale = h.send({ type: "startTraining", ...h.scope, generations: 1 });
  expect(
    h.events.some((e) => e.type === "error" && e.requestId === stale),
  ).toBe(true);
  const n = h.events.length;
  h.runtime.receive({
    protocolVersion: 1,
    sessionId: "old-session",
    requestId: "old",
    command: { type: "dispose" },
  });
  expect(h.events).toHaveLength(n);
  h.send({ type: "dispose" });
  expect(h.runtime.status().disposed).toBe(true);
  expect(h.runtime.needsWork).toBe(false);
});
