import { z } from "zod";
import {
  validateCheckpoint,
  type ExperimentCheckpoint,
} from "../core/evolution";
import { validateScenario } from "../core/world/scenario";
import type {
  EpisodeDefinition,
  EpisodeState,
  DecisionTrace,
} from "../core/episode";
import type { TrialResult } from "../core/model";
import type { GenerationCommit, ExperimentPhase } from "../core/experiment";
import { restoreEpisode, type EpisodeCheckpoint } from "../core/episode";
import type { SensorComparison } from "../core/comparison";

export const PROTOCOL_VERSION = 1;
const id = z.string().min(1).max(256);
const scope = { experimentId: id, epoch: z.number().int().nonnegative() };
const checkpoint = z.custom<ExperimentCheckpoint>((value) => {
  try {
    validateCheckpoint(value as ExperimentCheckpoint);
    return true;
  } catch {
    return false;
  }
}, "Invalid experiment checkpoint");
const episode = z.object({
  scenario: z.custom<EpisodeDefinition["scenario"]>((value) => {
    try {
      validateScenario(value as EpisodeDefinition["scenario"]);
      return true;
    } catch {
      return false;
    }
  }),
  controller: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("scripted"), id }),
    z.object({
      kind: z.literal("constant"),
      id,
      left: z.number().min(-1).max(1),
      right: z.number().min(-1).max(1),
    }),
    z.object({ kind: z.literal("random"), id, seed: z.string() }),
    z.object({
      kind: z.literal("neural"),
      id,
      parameters: z.custom<Float32Array>(
        (v) =>
          v instanceof Float32Array &&
          v.length === 278 &&
          v.every(Number.isFinite),
      ),
    }),
  ]),
  trace: z.boolean().optional(),
});
const commands = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("comparePlayback"),
    ...scope,
    playbackId: id,
    channel: z.number().int().min(0).max(19),
  }),
  z.object({
    type: z.literal("replayComparison"),
    ...scope,
    channel: z.number().int().min(0).max(19),
    source: z.custom<EpisodeCheckpoint>((v) => {
      try {
        const c = v as EpisodeCheckpoint;
        if (c.definition.scenario.config.maxTicks > 5400) return false;
        restoreEpisode(c);
        return true;
      } catch {
        return false;
      }
    }),
  }),
  z.object({ type: z.literal("initialize"), checkpoint }),
  z.object({
    type: z.literal("startTraining"),
    ...scope,
    generations: z.number().int().min(1).max(10000),
  }),
  z.object({ type: z.literal("pauseTraining"), ...scope }),
  z.object({ type: z.literal("commitSucceeded"), ...scope, commitId: id }),
  z.object({
    type: z.literal("commitFailed"),
    ...scope,
    commitId: id,
    message: z.string().max(2000),
  }),
  z.object({
    type: z.literal("requestCheckpoint"),
    ...scope,
    mode: z.enum(["latest", "afterGeneration"]),
  }),
  z.object({
    type: z.literal("openPlayback"),
    playbackId: id,
    definition: episode,
  }),
  z.object({
    type: z.literal("setPlaybackState"),
    playbackId: id,
    playing: z.boolean(),
    speed: z.number().min(0.1).max(64),
  }),
  z.object({
    type: z.literal("stepPlayback"),
    playbackId: id,
    mode: z.enum(["tick", "decision"]),
  }),
  z.object({ type: z.literal("inspectPlayback"), playbackId: id }),
  z.object({
    type: z.literal("seekPlayback"),
    playbackId: id,
    tick: z.number().int().min(0).max(1000000),
  }),
  z.object({
    type: z.literal("snapshotReceived"),
    frameId: z.number().int().positive(),
  }),
  z.object({ type: z.literal("cancelRequest"), targetRequestId: id }),
  z.object({ type: z.literal("dispose") }),
]);
export type CommandBody = z.infer<typeof commands>;
export const commandSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: id,
  requestId: id,
  command: commands,
});
export type Command = z.infer<typeof commandSchema>;
export interface RuntimeStatus {
  experimentId: string | null;
  epoch: number;
  phase: ExperimentPhase | null;
  generation: number | null;
  completedTrials: number;
  totalTrials: number;
  activeTick: number | null;
  training: boolean;
  targetGeneration: number | null;
  playbackId: string | null;
  playing: boolean;
  seeking: boolean;
  disposed: boolean;
}
export interface PlaybackSnapshot {
  playbackId: string;
  state: EpisodeState;
  decision: DecisionTrace | null;
  result: TrialResult | null;
}
export type ReplyData =
  | { type: "status"; status: RuntimeStatus }
  | { type: "checkpoint"; checkpoint: ExperimentCheckpoint }
  | { type: "playback"; snapshot: PlaybackSnapshot }
  | { type: "comparison"; comparison: SensorComparison }
  | { type: "disposed" };
interface EventBase {
  protocolVersion: 1;
  sessionId: string;
  sequence: number;
  experimentId: string | null;
  epoch: number;
}
export type RuntimeEvent = EventBase &
  (
    | { type: "ready" }
    | { type: "reply"; requestId: string; data: ReplyData }
    | { type: "status"; status: RuntimeStatus }
    | { type: "snapshot"; frameId: number; snapshot: PlaybackSnapshot }
    | { type: "generationCommit"; commit: GenerationCommit }
    | {
        type: "error";
        requestId: string | null;
        scope: "command" | "training" | "playback" | "worker";
        code: string;
        message: string;
      }
  );
export type EventPayload = RuntimeEvent extends infer E
  ? E extends EventBase
    ? Omit<E, keyof EventBase>
    : never
  : never;
export function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as RuntimeEvent;
  return (
    v.protocolVersion === 1 &&
    typeof v.sessionId === "string" &&
    Number.isInteger(v.sequence) &&
    typeof v.epoch === "number" &&
    [
      "ready",
      "reply",
      "status",
      "snapshot",
      "generationCommit",
      "error",
    ].includes(v.type)
  );
}
