import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { readArchive } from "../../src/persistence/archive";
import { checkpointHash } from "../../src/core/branch";
async function train(page: Page, count = 1) {
  await page.getByLabel("Generations to train").fill(String(count));
  await page
    .getByRole("button", {
      name: `Train ${count} generation${count === 1 ? "" : "s"}`,
      exact: true,
    })
    .click();
}
async function study(page: Page) {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "Create experiment", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Experiment name", { exact: true })
    .fill("Source study");
  await page.getByLabel("Random seed", { exact: true }).fill("m9-source");
  await page.getByLabel("Population", { exact: true }).fill("16");
  await page.getByLabel("Episode seconds", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Create experiment", exact: true })
    .click();
  await train(page);
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 1",
  );
}
async function exported(
  page: Page,
  info: TestInfo,
  name: string,
  full = false,
) {
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: full ? "Export full lineage" : "Export checkpoint",
      exact: true,
    })
    .click();
  const file = info.outputPath(name);
  await (await downloading).saveAs(file);
  return { file, session: readArchive(new Uint8Array(await readFile(file))) };
}
async function fork(page: Page) {
  await page.getByText("Create a branch", { exact: true }).click();
  await page.getByLabel("Branch name", { exact: true }).fill("Narrow sensors");
  await page.getByLabel("Branch sensor range", { exact: true }).fill("70");
  await page.getByLabel("Branch body radius", { exact: true }).fill("10");
  await page.getByLabel("Branch food count", { exact: true }).fill("24");
  await expect(
    page
      .getByRole("table", { name: "Proposed branch changes" })
      .locator("tbody tr"),
  ).toHaveCount(3);
  await page
    .getByRole("button", {
      name: "Create branch from saved population",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("branch-source-hash")).toBeVisible();
}
async function matrix(page: Page, source: string, count = 1) {
  await page
    .getByLabel("Reference experiment", { exact: true })
    .selectOption(source);
  await page
    .getByLabel("Maps per environment", { exact: true })
    .fill(String(count));
  await page
    .getByRole("button", {
      name: "Compare training-selected champions",
      exact: true,
    })
    .click();
  await expect(page.locator(".branch-matrix-status")).toHaveText(
    "Matrix saved locally.",
  );
}
async function fingerprint(page: Page) {
  return {
    id: await page.getByTestId("branch-matrix").getAttribute("data-matrix-id"),
    table: await page
      .getByRole("table", { name: "Champion environment matrix" })
      .innerText(),
    suites: await page
      .getByRole("table", { name: "Champion environment matrix" })
      .locator("td[data-suite-id]")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-suite-id")),
      ),
  };
}
test("branches preserve their source and replay a complete champion/environment matrix after portable restore", async ({
  page,
  browser,
}, info) => {
  await study(page);
  const sourceId = await page
      .getByLabel("Saved experiments", { exact: true })
      .inputValue(),
    source = await exported(page, info, "source.evolab");
  await fork(page);
  await expect(page.getByTestId("branch-source-hash")).toHaveText(
    checkpointHash(source.session.checkpoint),
  );
  const branchId = await page
    .getByLabel("Saved experiments", { exact: true })
    .inputValue();
  expect(branchId).not.toBe(sourceId);
  await train(page);
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 2",
  );
  await matrix(page, sourceId);
  const expected = await fingerprint(page),
    archive = await exported(page, info, "branch.evolab", true);
  expect(
    archive.session.branchOrigins![0].source.members.map(
      (m) => m.parameterHash,
    ),
  ).toEqual(source.session.checkpoint.population.map((g) => g.parameterHash));
  expect(archive.session.matrices![0].cells).toHaveLength(4);
  expect(
    archive.session.matrices![0].suites[0].scenarios[0].config.sensorRange,
  ).toBe(140);
  expect(
    archive.session.matrices![0].suites[1].scenarios[0].config.sensorRange,
  ).toBe(70);
  await page
    .getByRole("button", { name: "Open source experiment", exact: true })
    .click();
  await expect(
    page.getByLabel("Saved experiments", { exact: true }),
  ).toHaveValue(sourceId);
  const unchanged = await exported(page, info, "unchanged.evolab");
  expect(unchanged.session.checkpoint).toEqual(source.session.checkpoint);
  expect(unchanged.session.history).toEqual(source.session.history);
  await page
    .getByLabel("Saved experiments", { exact: true })
    .selectOption(branchId);
  await page
    .getByRole("button", { name: "Replay saved matrix", exact: true })
    .click();
  await expect(page.locator(".branch-matrix-status")).toHaveText(
    "Matrix replay matches every saved cell exactly. Saved locally.",
  );
  expect(await fingerprint(page)).toEqual(expected);
  const context = await browser.newContext(),
    imported = await context.newPage();
  try {
    await imported.goto(page.url());
    await expect(
      imported.getByRole("button", { name: "Import checkpoint", exact: true }),
    ).toBeEnabled();
    await imported
      .getByLabel("Checkpoint archive", { exact: true })
      .setInputFiles(archive.file);
    await expect(imported.getByTestId("branch-matrix")).toBeVisible();
    await imported
      .getByRole("button", { name: "Replay saved matrix", exact: true })
      .click();
    await expect(imported.locator(".branch-matrix-status")).toHaveText(
      "Matrix replay matches every saved cell exactly. Saved locally.",
    );
    expect(await fingerprint(imported)).toEqual(expected);
    await expect(
      imported.getByRole("button", {
        name: "Open source experiment",
        exact: true,
      }),
    ).toBeDisabled();
    await train(imported);
    await expect(imported.locator(".save-status strong")).toHaveText(
      "Saved population 3",
    );
    const commit = await imported
      .getByRole("button", { name: /Generation 2 champion/ })
      .getAttribute("data-commit-id");
    await train(page);
    await expect(
      page.getByRole("button", { name: /Generation 2 champion/ }),
    ).toHaveAttribute("data-commit-id", commit!);
  } finally {
    await context.close();
  }
});
test("hidden clamps and actual parent-weight restoration persist and rerun without changing the population", async ({
  page,
}, info) => {
  await study(page);
  const before = await exported(page, info, "before.evolab");
  await page.getByLabel("Playback tick", { exact: true }).fill("17");
  await page
    .getByLabel("Intervention type", { exact: true })
    .selectOption("hiddenClamp");
  await page
    .getByLabel("Hidden neuron to clamp", { exact: true })
    .selectOption("0");
  await page.getByLabel("Clamped activation", { exact: true }).fill("-1");
  await page
    .getByRole("button", { name: "Run matched comparison", exact: true })
    .click();
  await expect(page.locator(".comparison-status")).toHaveText(
    "Comparison saved locally.",
  );
  await expect(page.getByTestId("comparison-effective")).toHaveText("-1.0000");
  await expect(page.getByTestId("comparison-start-tick")).toHaveText("18");
  const child = before.session.checkpoint.population.find(
      (g) => g.origin === "mutation",
    )!,
    parameter = child.mutation!.changes[0].index;
  await page
    .getByLabel("Selected controller", { exact: true })
    .selectOption(`population:${child.id}`);
  await page
    .getByLabel("Intervention type", { exact: true })
    .selectOption("parentWeight");
  await page
    .getByLabel("Parameter to restore", { exact: true })
    .fill(String(parameter));
  await page
    .getByRole("button", { name: "Run matched comparison", exact: true })
    .click();
  await expect(page.locator(".comparison-status")).toHaveText(
    "Comparison saved locally.",
  );
  const file = await exported(page, info, "interventions.evolab");
  expect(file.session.checkpoint).toEqual(before.session.checkpoint);
  expect(file.session.comparisons).toHaveLength(2);
  const restored = file.session.comparisons!.find(
    (c) => c.intervention.kind === "parentWeight",
  )!;
  expect(
    restored.intervention.kind === "parentWeight" &&
      restored.intervention.value,
  ).toBe(restored.restoration!.parent.parameters[parameter]);
  await page
    .getByLabel("Checkpoint archive", { exact: true })
    .setInputFiles(file.file);
  await expect(
    page.getByLabel("Saved comparison", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await page
    .getByLabel("Saved comparison", { exact: true })
    .selectOption(restored.id);
  await page
    .getByRole("button", { name: "Replay saved comparison", exact: true })
    .click();
  await expect(page.locator(".comparison-status")).toContainText(
    "Replay matches the saved outcomes and trajectories exactly",
  );
  await page.reload();
  await expect(
    page.getByLabel("Saved comparison", { exact: true }).locator("option"),
  ).toHaveCount(2);
});
test("failed branch creation rolls back atomically and leaves the source usable", async ({
  page,
}, info) => {
  await study(page);
  const source = await exported(page, info, "source-failure.evolab"),
    id = await page
      .getByLabel("Saved experiments", { exact: true })
      .inputValue();
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    Reflect.set(window, "m9FailFork", true);
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "lineageNodes" && Reflect.get(window, "m9FailFork"))
        throw new DOMException("Injected branch failure", "QuotaExceededError");
      return add.apply(this, args);
    };
  });
  await page.getByText("Create a branch", { exact: true }).click();
  await page.getByLabel("Branch name", { exact: true }).fill("Failed fork");
  await page
    .getByRole("button", {
      name: "Create branch from saved population",
      exact: true,
    })
    .click();
  await expect(page.locator(".error-banner")).toContainText(
    "Injected branch failure",
  );
  await expect(
    page.getByLabel("Saved experiments", { exact: true }),
  ).toHaveValue(id);
  await expect(
    page.getByLabel("Saved experiments", { exact: true }).locator("option"),
  ).toHaveCount(2);
  const after = await exported(page, info, "source-after-failure.evolab");
  expect(after.session.checkpoint).toEqual(source.session.checkpoint);
  await page.evaluate(() => Reflect.set(window, "m9FailFork", false));
  await page
    .getByRole("button", { name: "Dismiss error", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Create branch from saved population",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("branch-source-hash")).toBeVisible();
});
test("matrix save failures remain exportable and branch/intervention views are accessible on narrow screens", async ({
  page,
}, info) => {
  await study(page);
  const source = await page
    .getByLabel("Saved experiments", { exact: true })
    .inputValue();
  await fork(page);
  await train(page);
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 2",
  );
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    Reflect.set(window, "m9FailMatrix", true);
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "matrices" && Reflect.get(window, "m9FailMatrix"))
        throw new DOMException("Injected matrix quota", "QuotaExceededError");
      return add.apply(this, args);
    };
  });
  await page
    .getByLabel("Reference experiment", { exact: true })
    .selectOption(source);
  await page.getByLabel("Maps per environment", { exact: true }).fill("1");
  await page
    .getByRole("button", {
      name: "Compare training-selected champions",
      exact: true,
    })
    .click();
  await expect(page.locator(".branch-matrix-status")).toContainText(
    "Matrix is in memory; saving failed",
  );
  const pending = await exported(page, info, "pending-matrix.evolab");
  expect(pending.session.matrices).toHaveLength(1);
  await page.evaluate(() => Reflect.set(window, "m9FailMatrix", false));
  await page
    .getByRole("button", { name: "Retry matrix save", exact: true })
    .click();
  await expect(page.locator(".branch-matrix-status")).toHaveText(
    "Matrix saved locally.",
  );
  await page.getByText("Create a branch", { exact: true }).click();
  await page
    .getByText("Recorded environments and cell trials", { exact: true })
    .click();
  const audit = async () => {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  };
  await audit();
  await page
    .locator(".branches-panel")
    .screenshot({ path: "artifacts/m9/branches-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await audit();
  await page
    .locator(".branches-panel")
    .screenshot({ path: "artifacts/m9/branches-mobile.png" });
  await page
    .getByLabel("Intervention type", { exact: true })
    .selectOption("hiddenClamp");
  await page.getByLabel("Clamped activation", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Run matched comparison", exact: true })
    .click();
  await expect(page.locator(".comparison-status")).toHaveText(
    "Comparison saved locally.",
  );
  await page
    .getByText("Raw and effective hidden activations", { exact: true })
    .click();
  await audit();
  await page
    .locator(".comparison-panel")
    .screenshot({ path: "artifacts/m9/clamp-mobile.png" });
});
