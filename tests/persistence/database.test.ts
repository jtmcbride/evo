import "fake-indexeddb/auto";
import { test, expect } from "vitest";
import { IndexedRepository } from "../../src/persistence/database";
import { RevisionConflict } from "../../src/persistence/repository";
import { savedFixture, nextFixture } from "./fixtures";
test("atomic saves, idempotent retry and revision conflicts preserve the head", async () => {
  const repo = new IndexedRepository(`test-${crypto.randomUUID()}`);
  try {
    const initial = savedFixture(),
      created = await repo.create(initial),
      next = nextFixture(initial);
    await repo.markRunning(created.entry.id, 0);
    expect((await repo.load(created.entry.id)).entry.interrupted).toBe(true);
    const saved = await repo.save(
      created.entry.id,
      0,
      next.session,
      next.commit,
    );
    expect(saved.entry.revision).toBe(1);
    expect((await repo.load(created.entry.id)).session).toEqual(next.session);
    expect(
      (await repo.save(created.entry.id, 0, next.session, next.commit)).entry
        .revision,
    ).toBe(1);
    const later = nextFixture(next.session);
    await expect(
      repo.save(created.entry.id, 0, later.session, later.commit),
    ).rejects.toBeInstanceOf(RevisionConflict);
    expect((await repo.load(created.entry.id)).entry.generation).toBe(1);
  } finally {
    await repo.db.delete();
  }
});
test("a failed checkpoint write rolls back all births, results and head changes", async () => {
  const repo = new IndexedRepository(`test-${crypto.randomUUID()}`);
  try {
    const initial = savedFixture(),
      created = await repo.create(initial),
      next = nextFixture(initial),
      count = await repo.db.parameters.count();
    const fail = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
    repo.db.checkpoints.hook("creating", fail);
    await expect(
      repo.save(created.entry.id, 0, next.session, next.commit),
    ).rejects.toThrow();
    repo.db.checkpoints.hook("creating").unsubscribe(fail);
    expect((await repo.load(created.entry.id)).entry.generation).toBe(0);
    expect(await repo.db.parameters.count()).toBe(count);
    expect(await repo.db.trials.count()).toBe(0);
    expect(await repo.db.generations.count()).toBe(0);
    await repo.save(created.entry.id, 0, next.session, next.commit);
    expect((await repo.load(created.entry.id)).entry.generation).toBe(1);
  } finally {
    await repo.db.delete();
  }
});
test("reopening recovers a checksum-verified checkpoint without overwriting other saves", async () => {
  const name = `test-${crypto.randomUUID()}`,
    repo = new IndexedRepository(name),
    one = await repo.create(savedFixture("one")),
    two = await repo.create(savedFixture("two"));
  repo.close();
  const reopened = new IndexedRepository(name);
  try {
    expect((await reopened.list()).length).toBe(2);
    expect(await reopened.active()).toBe(two.entry.id);
    await reopened.activate(one.entry.id);
    expect(await reopened.active()).toBe(one.entry.id);
    await reopened.db.checkpoints.update([one.entry.id, 0], {
      payload: "corrupt",
    });
    await expect(reopened.load(one.entry.id)).rejects.toThrow("checksum");
    expect((await reopened.load(two.entry.id)).entry.id).toBe(two.entry.id);
  } finally {
    await reopened.db.delete();
  }
});
