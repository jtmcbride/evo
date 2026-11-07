import { test, expect } from "@playwright/test";
import type { RuntimeHarness } from "../../src/runtime/harness";
declare global {
  interface Window {
    m4: RuntimeHarness;
  }
}
test.beforeEach(async ({ page }) => {
  await page.goto("runtime.html");
  await page.waitForFunction(() => !!window.m4);
  await page.evaluate(() => window.m4.client.ready);
});
test("production worker trains identically with and without independent playback", async ({
  page,
}) => {
  const ids = await page.evaluate(async () => {
    const h = window.m4,
      cp = await h.initialize({ population: 16, ticks: 180 });
    const reference = h.reference(cp);
    await h.open();
    await h.playback("tick");
    await h.playback("decision");
    await h.playback("seek", 17);
    await h.start();
    return { reference: reference.id };
  });
  await expect
    .poll(() => page.evaluate(() => window.m4.commits().length))
    .toBe(1);
  expect(await page.evaluate(() => window.m4.commits()[0].id)).toBe(
    ids.reference,
  );
  const state = await page.evaluate(async () => {
    await window.m4.playback("inspect");
    return window.m4.snapshot();
  });
  expect(state?.state.tick).toBe(17);
  expect(state?.decision?.tick).toBe(15);
  const cp = await page.evaluate(() => window.m4.checkpoint());
  expect(cp.generation).toBe(1);
  await page.evaluate(() => window.m4.dispose());
});
test("default population keeps the page responsive and pause is promptly acknowledged", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.m4.initialize();
    await window.m4.open();
    await window.m4.start(10);
    await window.m4.playback("play");
  });
  const measurements = await page.evaluate(async () => {
    let beats = 0;
    const timer = setInterval(() => beats++, 10);
    await new Promise((r) => setTimeout(r, 300));
    const latencies: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await window.m4.pause();
      latencies.push(performance.now() - start);
      if (i < 4) {
        await window.m4.start(10);
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    clearInterval(timer);
    await window.m4.playback("pause");
    return { beats, latencies, status: window.m4.client.status() };
  });
  expect(measurements.beats).toBeGreaterThan(10);
  expect(Math.max(...measurements.latencies)).toBeLessThan(250);
  expect(measurements.status?.training).toBe(false);
  console.log("M4 responsiveness", JSON.stringify(measurements));
  await page.evaluate(() => window.m4.dispose());
});
test("save failure retains the pending generation and retry advances only after acknowledgment", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const h = window.m4;
    await h.initialize({ population: 16, ticks: 30 });
    h.setAutoCommit(false);
    await h.start(2);
  });
  await expect
    .poll(() => page.evaluate(() => window.m4.commits().length))
    .toBe(1);
  expect(
    await page.evaluate(async () => {
      const h = window.m4;
      await h.acknowledge(h.commits()[0].id, false);
      return (await h.checkpoint()).generation;
    }),
  ).toBe(0);
  expect(await page.evaluate(() => window.m4.client.status()?.training)).toBe(
    false,
  );
  await page.evaluate(async () => {
    const h = window.m4;
    await h.acknowledge(h.commits()[0].id);
  });
  expect((await page.evaluate(() => window.m4.checkpoint())).generation).toBe(
    1,
  );
  await page.evaluate(() => window.m4.dispose());
});

test("default population completes a generation in the production worker", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.m4.initialize();
    await window.m4.start();
  });
  const start = Date.now();
  await expect
    .poll(() => page.evaluate(() => window.m4.commits().length), {
      timeout: 15000,
    })
    .toBe(1);
  const summary = await page.evaluate(async () => {
    const commit = window.m4.commits()[0];
    return {
      generation: (await window.m4.checkpoint()).generation,
      trials: commit.record.trials.reduce((sum, r) => sum + r.length, 0),
      best: Math.max(...commit.record.totals) / 3,
    };
  });
  expect(summary.generation).toBe(1);
  expect(summary.trials).toBe(384);
  console.log(
    "M4 default generation",
    JSON.stringify({ ...summary, elapsedMs: Date.now() - start }),
  );
  await page.evaluate(() => window.m4.dispose());
});

test("a real worker failure rejects pending requests and notifies observers", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          `postMessage({protocolVersion:1,sessionId:'probe',sequence:1,epoch:0,experimentId:null,type:'ready'});setTimeout(()=>{throw new Error('injected worker failure')},50);`,
        ],
        { type: "text/javascript" },
      ),
    );
    const client = Reflect.construct(window.m4.client.constructor, [
      new Worker(url),
    ]) as typeof window.m4.client;
    let notified = false;
    client.subscribe((event) => {
      if (event.type === "error" && event.scope === "worker") notified = true;
    });
    try {
      await client.request({ type: "dispose" });
      return { error: "unexpected success", notified };
    } catch (error) {
      return { error: String(error), notified };
    } finally {
      client.close();
      URL.revokeObjectURL(url);
    }
  });
  expect(result.error).toContain("injected worker failure");
  expect(result.notified).toBe(true);
});
