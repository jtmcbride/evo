import { test, expect } from "vitest";
import {
  prepare,
  firstScenario,
  DEFAULT_SETTINGS,
  WorkbenchStore,
} from "../../src/ui/store";
import { SimulationClient } from "../../src/runtime/client";
import { SimulationRuntime } from "../../src/runtime/runtime";
import { createEpisode } from "../../src/core/episode";
class Transport {
  private listeners = new Map<string, Set<(event: unknown) => void>>();
  runtime: SimulationRuntime;
  private time = 0;
  constructor() {
    this.runtime = new SimulationRuntime(
      "ui-store",
      (event) =>
        queueMicrotask(() => {
          for (const fn of this.listeners.get("message") ?? [])
            fn({ data: event });
        }),
      () => (this.time += 0.02),
    );
  }
  addEventListener(type: string, fn: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  postMessage(value: unknown) {
    this.runtime.receive(value);
  }
  terminate() {}
}
test("draft validation and preview use actual first-training conditions", () => {
  const settings = {
      ...DEFAULT_SETTINGS,
      preset: "obstacles" as const,
      seed: "preview",
    },
    d = prepare(settings),
    world = firstScenario(d);
  expect(world.config.obstacleCount).toBe(5);
  expect(world).toEqual(firstScenario(d));
  expect(() => prepare({ ...settings, foodCount: 100000 })).toThrow();
  expect(() =>
    prepare({ ...settings, elites: 100, immigrants: 100 }),
  ).toThrow();
});
test("workbench keeps stable snapshots and replays the champion under its original scenario", async () => {
  const transport = new Transport(),
    client = new SimulationClient(transport as unknown as Worker),
    store = new WorkbenchStore(client);
  try {
    await client.ready;
    store.updateDraft({ population: 16, seconds: 5 });
    await store.create();
    expect(store.getInspection()?.decision?.tick).toBe(0);
    expect(store.getInspection()?.state.tick).toBe(1);
    expect(store.getView()).toBe(store.getView());
    store.updateDraft({ foodCount: NaN });
    expect(store.getView().configError).not.toBeNull();
    store.updateDraft({ foodCount: 48 });
    expect(store.getView().configError).toBeNull();
    await store.train(1);
    for (let i = 0; i < 100 && store.getView().history.length === 0; i++) {
      transport.runtime.pump();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const row = store.getView().history[0];
    expect(row).toBeDefined();
    await store.selectChampion(row.generation);
    const selection = store.getView().selection!;
    expect(selection.genome.id).toBe(row.championId);
    expect(selection.scenario.hash).toBe(
      selection.recordedResult?.spec.scenarioHash,
    );
    const episode = createEpisode({
      scenario: selection.scenario,
      controller: {
        kind: "neural",
        id: selection.genome.id,
        parameters: selection.genome.parameters,
      },
    });
    episode.advance(150);
    expect(episode.result()).toEqual(selection.recordedResult);
    const before = transport.runtime.status();
    store.preference({ sensorOnly: true, showTrail: false });
    expect(transport.runtime.status()).toEqual(before);
    await store.playback("decision");
    expect(store.getInspection()?.decision?.tick).toBe(3);
  } finally {
    store.dispose();
  }
});

test("a selected champion keeps its trial choices when older history is evicted", async () => {
  const transport = new Transport(),
    client = new SimulationClient(transport as unknown as Worker),
    store = new WorkbenchStore(client);
  const until = async (count: number) => {
    for (let i = 0; i < 2000 && store.getView().history.length < count; i++) {
      transport.runtime.pump();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(store.getView().history).toHaveLength(count);
  };
  try {
    await client.ready;
    expect(store.getTrialCount()).toBe(1);
    store.updateDraft({ population: 16, seconds: 5 });
    await store.create();
    await store.train(1);
    await until(1);
    await store.selectChampion(0, 1);
    const original = store.getView().selection!.scenario.hash;
    await store.train(50);
    await until(51);
    expect(store.getView().replayGenerations).toHaveLength(50);
    expect(store.getView().replayGenerations).not.toContain(0);
    expect(store.getTrialCount()).toBe(3);
    await store.selectChampion(0, 1);
    expect(store.getView().selection!.scenario.hash).toBe(original);
  } finally {
    store.dispose();
  }
}, 15000);
