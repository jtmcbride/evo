import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import { readArchive } from "../../src/persistence/archive";
import { reconstructGenome } from "../../src/core/lineage";

async function study(page: Page, generations = 3) {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "Create experiment", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Random seed", { exact: true }).fill("m8-lineage");
  await page.getByLabel("Population", { exact: true }).fill("16");
  await page.getByLabel("Episode seconds", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Create experiment", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Export full lineage", exact: true }),
  ).toBeEnabled();
  await train(page, generations);
  await expect(page.locator(".save-status strong")).toHaveText(
    `Saved population ${generations}`,
  );
}
async function train(page: Page, generations: number) {
  await page.getByLabel("Generations to train").fill(String(generations));
  await page
    .getByRole("button", {
      name: `Train ${generations} generation${generations === 1 ? "" : "s"}`,
      exact: true,
    })
    .click();
}
async function exported(page: Page, info: TestInfo, name: string, full = true) {
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
async function find(page: Page, id: string) {
  await page.getByLabel("Retained controller ID", { exact: true }).fill(id);
  await page
    .getByRole("button", { name: "Find retained controller", exact: true })
    .click();
  await expect(page.getByTestId("lineage-selected")).toHaveAttribute(
    "data-genome-id",
    id,
  );
  await expect(
    page.getByRole("button", {
      name: "Replay retained controller",
      exact: true,
    }),
  ).toBeEnabled();
}
async function compare(page: Page) {
  await page
    .getByLabel("Shared comparison maps", { exact: true })
    .selectOption("recorded");
  await page
    .getByRole("button", { name: "Compare parent and child", exact: true })
    .click();
  await expect(page.getByTestId("lineage-pair")).toBeVisible();
  await expect(
    page.locator(".lineage-panel").getByRole("status"),
  ).toContainText("Comparison complete");
  return {
    suite: await page.getByTestId("lineage-pair").getAttribute("data-suite-id"),
    table: await page
      .getByRole("table", { name: "Parent and child outcomes" })
      .innerText(),
    paths: await page
      .locator(".lineage-pair .comparison-path")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("points"))),
  };
}
test("retired lineage, exact mutation values and original trials survive full archive import", async ({
  page,
  browser,
}, info) => {
  await study(page);
  const first = await exported(page, info, "all-births.evolab"),
    lineage = first.session.lineage!;
  const retired = lineage.nodes.find(
    (n) =>
      n.genome.origin === "mutation" &&
      n.genome.birthGeneration < 3 &&
      !first.session.checkpoint.population.some((g) => g.id === n.genome.id),
  )!.genome;
  const nodes = new Map(lineage.nodes.map((n) => [n.genome.id, n])),
    parent = reconstructGenome(retired.parentIds[0], (id) => nodes.get(id));
  await find(page, retired.id);
  await expect(page.getByTestId("lineage-parameter-hash")).toHaveText(
    retired.parameterHash,
  );
  await page.locator(".lineage-mutations summary").click();
  for (const change of retired.mutation!.changes.slice(0, 3)) {
    const row = page
      .getByRole("table", { name: "Mutation parameter values" })
      .locator(`tr[data-parameter-index="${change.index}"]`);
    const exact = (v: number) => (Object.is(v, -0) ? "−0" : String(v));
    await expect(row.locator("td").nth(1)).toHaveText(
      exact(parent.parameters[change.index]),
    );
    await expect(row.locator("td").nth(2)).toHaveText(exact(change.value));
  }
  const expected = await compare(page);
  const recorded = lineage.generations.find(
      (g) => g.generation === retired.birthGeneration,
    )!,
    slot = recorded.populationIds.indexOf(retired.id),
    food =
      recorded.trials[slot].reduce((sum, t) => sum + t.score, 0) /
      recorded.scenarios.length;
  await expect(
    page
      .getByRole("table", { name: "Parent and child outcomes" })
      .locator("tbody tr")
      .first()
      .locator("td")
      .nth(1),
  ).toHaveText(food.toFixed(4));
  await page
    .getByRole("button", { name: "Replay retained controller", exact: true })
    .click();
  await page
    .getByLabel("Selected training trial", { exact: true })
    .selectOption("1");
  await page.getByLabel("Playback tick", { exact: true }).fill("150");
  await expect(page.locator(".decision-stamp")).toContainText("Body tick 150");
  await page.getByRole("tab", { name: "Measures", exact: true }).click();
  await expect(
    page
      .getByText("Replay result", { exact: true })
      .locator("..")
      .locator("dd"),
  ).toHaveText(`${recorded.trials[slot][1].foodCollected} food`);
  const portable = await exported(page, info, "selected-ancestor.evolab");
  expect(portable.session.bookmark?.lineageId).toBe(retired.id);
  const context = await browser.newContext(),
    imported = await context.newPage();
  try {
    await imported.goto(page.url());
    await expect(
      imported.getByRole("button", { name: "Import checkpoint", exact: true }),
    ).toBeEnabled();
    await imported
      .getByLabel("Checkpoint archive", { exact: true })
      .setInputFiles(portable.file);
    await expect(imported.getByTestId("lineage-selected")).toHaveAttribute(
      "data-genome-id",
      retired.id,
    );
    await expect(imported.locator(".decision-stamp")).toContainText(
      "Body tick 150",
    );
    await expect(imported.getByTestId("lineage-parameter-hash")).toHaveText(
      retired.parameterHash,
    );
    expect(await compare(imported)).toEqual(expected);
    await train(imported, 1);
    await expect(imported.locator(".save-status strong")).toHaveText(
      "Saved population 4",
    );
    const commit = await imported
      .getByRole("button", { name: /Generation 3 champion/ })
      .getAttribute("data-commit-id");
    await train(page, 1);
    await expect(
      page.getByRole("button", { name: /Generation 3 champion/ }),
    ).toHaveAttribute("data-commit-id", commit!);
    await imported.reload();
    await expect(imported.getByTestId("lineage-selected")).toHaveAttribute(
      "data-genome-id",
      retired.id,
    );
    expect(await compare(imported)).toEqual(expected);
  } finally {
    await context.close();
  }
});
test("checkpoint-only imports label partial history and preserve failed lookup state", async ({
  page,
}, info) => {
  await study(page, 2);
  const full = await exported(page, info, "complete.evolab"),
    checkpoint = await exported(page, info, "partial.evolab", false);
  expect(checkpoint.session.lineage).toBeUndefined();
  const retained = new Set([
    ...checkpoint.session.checkpoint.population.map((g) => g.id),
    ...checkpoint.session.replays.map((r) => r.genome.id),
    checkpoint.session.bookmark?.genome.id,
  ]);
  const missing = full.session.lineage!.nodes.find(
    (n) => !retained.has(n.genome.id),
  )!.genome.id;
  await page
    .getByLabel("Checkpoint archive", { exact: true })
    .setInputFiles(checkpoint.file);
  await expect(page.locator(".lineage-coverage")).toContainText(
    "Complete generation records begin at generation 2",
  );
  const before = await page
    .getByTestId("lineage-selected")
    .getAttribute("data-genome-id");
  await page
    .getByLabel("Retained controller ID", { exact: true })
    .fill(missing);
  await page
    .getByRole("button", { name: "Find retained controller", exact: true })
    .click();
  await expect(page.locator(".lineage-error")).toContainText(
    "Missing lineage record",
  );
  await expect(page.getByTestId("lineage-selected")).toHaveAttribute(
    "data-genome-id",
    before!,
  );
  const exportedPartial = await exported(page, info, "partial-lineage.evolab");
  expect(exportedPartial.session.lineage?.fromGeneration).toBe(2);
});
test("lineage navigation, mutation tables and parent-child plots are accessible at desktop and mobile widths", async ({
  page,
}, info) => {
  await study(page);
  const { session } = await exported(page, info, "accessibility.evolab"),
    child = session.lineage!.nodes.find(
      (n) => n.genome.origin === "mutation" && n.genome.birthGeneration === 1,
    )!.genome;
  await find(page, child.id);
  await page.locator(".lineage-mutations summary").click();
  await compare(page);
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
    .locator(".lineage-panel")
    .screenshot({ path: "artifacts/m8/lineage-desktop.png" });
  const parentId = child.parentIds[0];
  await page
    .getByRole("button", { name: `Inspect ancestor ${parentId}`, exact: true })
    .click();
  await expect(page.getByTestId("lineage-selected")).toHaveAttribute(
    "data-genome-id",
    parentId,
  );
  await page
    .getByRole("button", { name: `Inspect child ${child.id}`, exact: true })
    .click();
  await expect(page.getByTestId("lineage-selected")).toHaveAttribute(
    "data-genome-id",
    child.id,
  );
  await compare(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".lineage-mutations summary").click();
  await audit();
  await page.locator(".lineage-mutations summary").click();
  await page
    .locator(".lineage-panel")
    .screenshot({ path: "artifacts/m8/lineage-mobile.png" });
});
