import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { readArchive } from "../../src/persistence/archive";

async function study(page: Page) {
  await page.goto("./");
  await page.getByText("Experiment settings", { exact: true }).waitFor();
  if (!(await page.getByLabel("Random seed", { exact: true }).isVisible()))
    await page.getByText("Experiment settings", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create experiment", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Random seed", { exact: true }).fill("m7-paired");
  await page.getByLabel("Population", { exact: true }).fill("16");
  await page.getByLabel("Episode seconds", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Create experiment", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Run matched comparison", exact: true }),
  ).toBeEnabled();
}
async function compare(page: Page) {
  await page.getByLabel("Sensor to mask", { exact: true }).selectOption("16");
  await page
    .getByRole("button", { name: "Run matched comparison", exact: true })
    .click();
  await expect(page.locator(".comparison-status")).toHaveText(
    "Comparison saved locally.",
  );
}
async function fingerprint(page: Page) {
  return {
    id: await page
      .locator(".comparison-outcomes")
      .getAttribute("data-comparison-id"),
    outcomes: await page
      .getByRole("table", { name: "Comparison outcomes", exact: true })
      .innerText(),
    paths: await page
      .locator(".comparison-path")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("points"))),
  };
}
test("a mask starts at the next decision and reproduces both outcomes after reload", async ({
  page,
}) => {
  await study(page);
  await page.getByLabel("Playback tick", { exact: true }).fill("17");
  await expect(page.locator(".decision-stamp")).toContainText("Body tick 17");
  await compare(page);
  await expect(page.getByTestId("comparison-start-tick")).toHaveText("18");
  await expect(page.getByTestId("comparison-effective")).toHaveText("0.0000");
  expect(
    Number(await page.getByTestId("comparison-raw").innerText()),
  ).toBeGreaterThan(0);
  await expect(page.locator(".decision-stamp")).toContainText("Body tick 17");
  const before = await fingerprint(page);
  await page.reload();
  await expect(
    page.getByLabel("Saved comparison", { exact: true }),
  ).toBeVisible();
  expect(await fingerprint(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Replay saved comparison", exact: true })
    .click();
  await expect(page.locator(".comparison-status")).toHaveText(
    "Replay matches the saved outcomes and trajectories exactly. Saved locally.",
  );
  expect(await fingerprint(page)).toEqual(before);
  await expect(
    page.getByLabel("Saved comparison", { exact: true }).locator("option"),
  ).toHaveCount(1);
});
test("portable comparison archives replay in a fresh browser and survive further training", async ({
  page,
  browser,
}, info) => {
  await study(page);
  await compare(page);
  const before = await fingerprint(page),
    downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export checkpoint", exact: true })
    .click();
  const file = info.outputPath("comparison.evolab");
  await (await downloading).saveAs(file);
  const session = readArchive(new Uint8Array(await readFile(file))),
    record = session.comparisons![0];
  expect(record.id).toBe(before.id);
  expect(record.intervention.channel).toBe(16);
  // Numerical replay belongs to the same browser runtime, not the Node test host.
  const context = await browser.newContext(),
    imported = await context.newPage();
  try {
    await imported.goto(page.url());
    await imported
      .getByLabel("Checkpoint archive", { exact: true })
      .setInputFiles(file);
    await expect(
      imported.getByLabel("Saved comparison", { exact: true }),
    ).toBeVisible();
    expect(await fingerprint(imported)).toEqual(before);
    await imported
      .getByRole("button", { name: "Replay saved comparison", exact: true })
      .click();
    await expect(imported.locator(".comparison-status")).toContainText(
      "matches the saved outcomes",
    );
    await imported.getByLabel("Generations to train").fill("1");
    await imported
      .getByRole("button", { name: "Train 1 generation", exact: true })
      .click();
    await expect(imported.locator(".save-status strong")).toHaveText(
      "Saved population 1",
    );
    await imported.reload();
    await expect(imported.locator(".save-status strong")).toHaveText(
      "Saved population 1",
    );
    expect(await fingerprint(imported)).toEqual(before);
  } finally {
    await context.close();
  }
});
test("comparison save failure retains exportable results and retries without blocking training", async ({
  page,
}, info) => {
  await study(page);
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    Object.defineProperty(window, "m7FailSave", {
      value: true,
      writable: true,
    });
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "comparisons" && Reflect.get(window, "m7FailSave"))
        throw new DOMException(
          "Injected comparison storage failure",
          "QuotaExceededError",
        );
      return add.apply(this, args);
    };
  });
  await page
    .getByRole("button", { name: "Run matched comparison", exact: true })
    .click();
  await expect(page.locator(".comparison-status")).toContainText(
    "Comparison is in memory; saving failed",
  );
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export checkpoint", exact: true })
    .click();
  const file = info.outputPath("unsaved-comparison.evolab");
  await (await downloading).saveAs(file);
  expect(
    readArchive(new Uint8Array(await readFile(file))).comparisons,
  ).toHaveLength(1);
  await page.getByLabel("Generations to train").fill("1");
  await page
    .getByRole("button", { name: "Train 1 generation", exact: true })
    .click();
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 1",
  );
  await page.evaluate(() => Reflect.set(window, "m7FailSave", false));
  await page
    .getByRole("button", { name: "Retry comparison save", exact: true })
    .click();
  await expect(page.locator(".comparison-status")).toHaveText(
    "Comparison saved locally.",
  );
  await page.reload();
  await expect(
    page.getByLabel("Saved comparison", { exact: true }),
  ).toBeVisible();
});
test("comparison controls and results are accessible on desktop and narrow screens", async ({
  page,
}) => {
  await study(page);
  await compare(page);
  await page
    .getByText("All observations at the first affected decision", {
      exact: true,
    })
    .click();
  const audit = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  };
  await audit();
  await page
    .locator(".comparison-panel")
    .screenshot({ path: "artifacts/m7/comparison-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await audit();
  await page
    .getByText("All observations at the first affected decision", {
      exact: true,
    })
    .click();
  await page
    .locator(".comparison-panel")
    .screenshot({ path: "artifacts/m7/comparison-mobile.png" });
});
