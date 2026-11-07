import { test, expect } from "vitest";
import { commandSchema } from "../../src/runtime/protocol";
import { defineExperiment, initialCheckpoint } from "../../src/core/evolution";
const envelope = (command: unknown) => ({
  protocolVersion: 1,
  sessionId: "session",
  requestId: "request",
  command,
});
test("validates commands and rejects incompatible or malformed input", () => {
  const checkpoint = initialCheckpoint(defineExperiment("protocol"));
  expect(
    commandSchema.safeParse(envelope({ type: "initialize", checkpoint }))
      .success,
  ).toBe(true);
  checkpoint.population[0].parameters[0] += 1;
  expect(
    commandSchema.safeParse(envelope({ type: "initialize", checkpoint }))
      .success,
  ).toBe(false);
  for (const command of [
    { type: "startTraining", experimentId: "x", epoch: 1, generations: 0 },
    {
      type: "setPlaybackState",
      playbackId: "p",
      playing: true,
      speed: Infinity,
    },
    { type: "seekPlayback", playbackId: "p", tick: -1 },
    { type: "unknown" },
  ])
    expect(commandSchema.safeParse(envelope(command)).success).toBe(false);
  expect(
    commandSchema.safeParse({
      ...envelope({ type: "dispose" }),
      protocolVersion: 2,
    }).success,
  ).toBe(false);
});
