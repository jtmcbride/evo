import { test, expect, vi } from "vitest";
import { SimulationClient } from "../../src/runtime/client";
import type { RuntimeEvent } from "../../src/runtime/protocol";
class Transport {
  listeners = new Map<string, Set<(event: unknown) => void>>();
  sent: unknown[] = [];
  terminated = false;
  addEventListener(type: string, fn: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  postMessage(value: unknown) {
    this.sent.push(value);
  }
  terminate() {
    this.terminated = true;
  }
  emit(type: string, value: unknown) {
    for (const f of this.listeners.get(type) ?? []) f(value);
  }
  event(event: Partial<RuntimeEvent>) {
    this.emit("message", {
      data: {
        protocolVersion: 1,
        sessionId: "s",
        sequence: 1,
        experimentId: null,
        epoch: 0,
        ...event,
      },
    });
  }
}
test("session filtering, request resolution and disposal reject outstanding work", async () => {
  const w = new Transport(),
    client = new SimulationClient(w as unknown as Worker);
  w.event({ type: "ready" });
  await client.ready;
  const result = client.request({ type: "dispose" });
  await Promise.resolve();
  const request = (w.sent[0] as { requestId: string }).requestId;
  w.event({
    type: "reply",
    sessionId: "old",
    sequence: 100,
    requestId: request,
    data: { type: "disposed" },
  });
  expect(w.terminated).toBe(false);
  w.event({
    type: "reply",
    sequence: 2,
    requestId: request,
    data: { type: "disposed" },
  });
  expect(await result).toEqual({ type: "disposed" });
  expect(w.terminated).toBe(true);
  await expect(client.request({ type: "dispose" })).rejects.toThrow("closed");
});
test("transport failure rejects queued requests and startup failure is bounded", async () => {
  const w = new Transport(),
    c = new SimulationClient(w as unknown as Worker);
  w.event({ type: "ready" });
  const p = c.request({ type: "dispose" });
  await Promise.resolve();
  w.emit("error", { message: "crash" });
  await expect(p).rejects.toThrow("crash");
  expect(w.terminated).toBe(true);
  vi.useFakeTimers();
  const x = new Transport(),
    d = new SimulationClient(x as unknown as Worker, 10);
  const waiting = d.request({ type: "dispose" });
  const rejected = expect(waiting).rejects.toThrow("startup timed out");
  await vi.advanceTimersByTimeAsync(20);
  await rejected;
  vi.useRealTimers();
});

test("request timeout sends cancellation and a fatal worker error reaches observers", async () => {
  vi.useFakeTimers();
  try {
    const w = new Transport(),
      c = new SimulationClient(w as unknown as Worker, 20),
      events: RuntimeEvent[] = [];
    c.subscribe((e) => events.push(e));
    w.event({ type: "ready" });
    const waiting = c.request({ type: "inspectPlayback", playbackId: "p" }),
      failure = expect(waiting).rejects.toThrow("request timed out");
    await vi.advanceTimersByTimeAsync(30);
    await failure;
    expect(
      w.sent.some(
        (v) =>
          (v as { command: { type: string } }).command.type === "cancelRequest",
      ),
    ).toBe(true);
    w.emit("error", { message: "fatal worker error" });
    expect(
      events.some(
        (e) =>
          e.type === "error" &&
          e.scope === "worker" &&
          e.message === "fatal worker error",
      ),
    ).toBe(true);
    expect(w.terminated).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
