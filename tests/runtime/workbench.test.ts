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
test("retired ancestors replay original trials and matched parent suites after saved bookmark recovery", async () => {
  const transport = new Transport(),
    store = new WorkbenchStore(
      new SimulationClient(transport as unknown as Worker),
    );
  const pump = async (check: () => boolean) => {
    for (let i = 0; i < 500 && !check(); i++) {
      transport.runtime.pump();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(check()).toBe(true);
  };
  try {
    await store.ready;
    store.updateDraft({ population: 16, seconds: 5, seed: "retired" });
    await store.create();
    await store.train(3);
    await pump(
      () =>
        store.getView().history.length === 3 &&
        store.getView().storage.state === "saved",
    );
    await new Promise((r) => setTimeout(r, 0));
    const snapshot = store.getExportSession(),
      local = store.getView().storage;
    const all = await store.repository.exportLineage(local.id!, local.revision),
      retired = all.nodes.find(
        (n) =>
          n.genome.origin === "mutation" &&
          n.genome.birthGeneration < 3 &&
          !snapshot.checkpoint.population.some((g) => g.id === n.genome.id),
      )!.genome;
    await store.browseLineage(retired.id);
    const family = store.getView().lineage!;
    expect(family.parent).not.toBeNull();
    expect(family.replay).not.toBeNull();
    await store.replayAncestor(retired.id, 1);
    expect(store.getView().selection?.lineageId).toBe(retired.id);
    expect(store.getTrialCount()).toBe(3);
    const seek = store.playback("seek", 150);
    await new Promise((r) => setTimeout(r, 0));
    await pump(() => !transport.runtime.status().seeking);
    await seek;
    expect(store.getInspection()?.result).toEqual(family.replay!.results[1]);
    const compare = store.compareLineage("recorded");
    await pump(() => !store.getView().lineageComparing);
    await compare;
    expect(
      store.getView().lineageComparison!.trials.map((t) => t.child.result),
    ).toEqual(family.replay!.results);
    expect(store.getExportSession().checkpoint).toEqual(snapshot.checkpoint);
    await store.retrySave();
    let loaded = false;
    const loading = store.loadSaved(local.id!).then(() => {
      loaded = true;
    });
    await pump(() => loaded);
    await loading;
    expect(store.getView().selection?.lineageId).toBe(retired.id);
    expect(store.getTrialCount()).toBe(3);
    expect(store.getInspection()?.result).toEqual(family.replay!.results[1]);
    await store.browseLineage("missing-controller");
    expect(store.getView().lineageError).toMatch(/Missing/);
    expect(store.getView().storage.blocked).toBe(false);
  } finally {
    store.dispose();
  }
});
test("comparison save failures retain exportable results, retry separately, and restore after loading", async () => {
  const { MemoryRepository } = await import("../../src/persistence/repository");
  class Faulty extends MemoryRepository {
    fail = true;
    override async saveComparison(
      ...args: Parameters<
        InstanceType<typeof MemoryRepository>["saveComparison"]
      >
    ) {
      if (this.fail)
        throw new DOMException(
          "Injected comparison quota failure",
          "QuotaExceededError",
        );
      return super.saveComparison(...args);
    }
  }
  const transport = new Transport(),
    repo = new Faulty(),
    store = new WorkbenchStore(
      new SimulationClient(transport as unknown as Worker),
      repo,
    );
  const run = async (work: Promise<void>) => {
    for (let i = 0; i < 100 && store.getView().comparing; i++) {
      transport.runtime.pump();
      await new Promise((r) => setTimeout(r, 0));
    }
    await work;
  };
  try {
    await store.ready;
    store.updateDraft({ population: 16, seconds: 5 });
    await store.create();
    const original = store.getInspection(),
      cp = store.getExportSession().checkpoint;
    await run(store.compareSensor(16));
    expect(store.getView().comparisonUnsaved).toBe(true);
    expect(store.getView().storage.blocked).toBe(false);
    expect(store.getExportSession().comparisons).toHaveLength(1);
    expect(store.getInspection()).toEqual(original);
    expect(store.getExportSession().checkpoint).toEqual(cp);
    repo.fail = false;
    await store.retryComparisons();
    expect(store.getView().comparisonUnsaved).toBe(false);
    const record = store.getView().comparisons[0],
      id = store.getView().storage.id!;
    await store.loadSaved(id);
    expect(store.getView().comparisons).toEqual([record]);
    await run(store.compareSensor(16, record));
    expect(store.getView().comparisonNotice).toMatch(/matches.*exactly/);
    expect(store.getView().comparisons).toHaveLength(1);
    await store.train(1);
    for (let i = 0; i < 200 && !store.getView().history.length; i++) {
      transport.runtime.pump();
      await new Promise((r) => setTimeout(r, 0));
    }
    await new Promise((r) => setTimeout(r, 0));
    await store.loadSaved(id);
    expect(store.getView().comparisons).toEqual([record]);
    const shifted = structuredClone(record);
    shifted.masked.firstDecision.hidden![0] += 1e-12;
    const portable = store.getExportSession();
    portable.comparisons = [shifted];
    const imported = await repo.create(portable);
    await store.loadSaved(imported.entry.id);
    await run(store.compareSensor(16, shifted));
    expect(store.getView().comparisonNotice).toMatch(
      /Replay differs.*original record is preserved/,
    );
    expect(store.getView().comparisons).toEqual([shifted]);
    expect((await repo.load(imported.entry.id)).session.comparisons).toEqual([
      shifted,
    ]);
  } finally {
    store.dispose();
  }
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

test("failed or unacknowledged saves retain an exportable population and retry once", async () => {
  const { MemoryRepository } = await import("../../src/persistence/repository");
  for (const afterWrite of [false, true]) {
    class Faulty extends MemoryRepository {
      fail = true;
      override async save(
        ...args: Parameters<InstanceType<typeof MemoryRepository>["save"]>
      ) {
        if (this.fail && args[3]) {
          this.fail = false;
          if (afterWrite) await super.save(...args);
          throw new DOMException(
            "Injected quota or lost result",
            "QuotaExceededError",
          );
        }
        return super.save(...args);
      }
    }
    const repo = new Faulty(),
      transport = new Transport(),
      client = new SimulationClient(transport as unknown as Worker),
      store = new WorkbenchStore(client, repo);
    try {
      await store.ready;
      store.updateDraft({ population: 16, seconds: 5 });
      await store.create();
      await store.train(1);
      for (
        let i = 0;
        i < 200 && store.getView().storage.state !== "error";
        i++
      ) {
        transport.runtime.pump();
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(store.getView().storage.blocked).toBe(true);
      expect(store.getExportSession().checkpoint.generation).toBe(1);
      expect(transport.runtime.status().generation).toBe(0);
      await store.retrySave();
      expect(store.getView().history).toHaveLength(1);
      expect(transport.runtime.status().generation).toBe(1);
      expect(
        (await repo.load(store.getView().storage.id!)).entry.generation,
      ).toBe(1);
    } finally {
      store.dispose();
    }
  }
});

test("a fast next generation is saved even while the previous library refresh is pending", async () => {
  const { MemoryRepository } = await import("../../src/persistence/repository");
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  class Slow extends MemoryRepository {
    hold = false;
    waiting = false;
    override async list() {
      if (this.hold) {
        this.hold = false;
        this.waiting = true;
        await gate;
      }
      return super.list();
    }
    override async save(
      ...args: Parameters<InstanceType<typeof MemoryRepository>["save"]>
    ) {
      const result = await super.save(...args);
      if (args[3]?.record.generation === 0) this.hold = true;
      return result;
    }
  }
  const repo = new Slow(),
    transport = new Transport(),
    client = new SimulationClient(transport as unknown as Worker),
    store = new WorkbenchStore(client, repo);
  try {
    await store.ready;
    store.updateDraft({ population: 16, seconds: 5 });
    await store.create();
    await store.train(3);
    for (
      let i = 0;
      i < 200 &&
      !(repo.waiting && transport.runtime.status().phase === "awaitingCommit");
      i++
    ) {
      transport.runtime.pump();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(repo.waiting).toBe(true);
    release();
    for (let i = 0; i < 200 && store.getView().history.length < 3; i++) {
      transport.runtime.pump();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(store.getView().history).toHaveLength(3);
  } finally {
    release();
    store.dispose();
  }
});
