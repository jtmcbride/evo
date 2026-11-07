import { AxeBuilder } from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
async function create(page: import("@playwright/test").Page, seed = "m5-case") {
  await page.goto("./");
  await page.getByText("Experiment settings", { exact: true }).waitFor();
  if (!(await page.getByLabel("Random seed", { exact: true }).isVisible()))
    await page.getByText("Experiment settings", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create experiment", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Random seed", { exact: true }).fill(seed);
  await page.getByLabel("Population", { exact: true }).fill("16");
  await page.getByLabel("Episode seconds", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Create experiment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Initial controller", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Step decision", exact: true }),
  ).toBeEnabled();
}
test("setup, train and historical replay preserve the original evaluation", async ({
  page,
  context,
}) => {
  const reference = await context.newPage();
  await reference.goto("runtime.html");
  await reference.waitForFunction(() => !!window.m4);
  const expected = await reference.evaluate(async () => {
    await window.m4.client.ready;
    const cp = await window.m4.initialize({
      population: 16,
      ticks: 150,
      seed: "m5-case",
    });
    const commit = window.m4.reference(cp);
    await window.m4.dispose();
    return commit.id;
  });
  await reference.close();
  await create(page);
  await page.getByLabel("Generations to train").fill("1");
  await page
    .getByRole("button", { name: "Train 1 generation", exact: true })
    .click();
  const champion = page.getByRole("button", { name: /Generation 0 champion/ });
  await expect(champion).toBeVisible();
  await expect(champion).toHaveAttribute("data-commit-id", expected);
  await champion.click();
  await expect(
    page.getByRole("heading", { name: "Generation 0 champion", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Step decision", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Step decision", exact: true })
    .click();
  await expect(page.locator(".decision-stamp")).toContainText("Decision 3");
  await page.getByLabel("Selected training trial").selectOption("1");
  await expect(page.locator(".decision-stamp")).toContainText("Decision 0");
  await page.getByLabel("Sensor only", { exact: true }).check();
  await expect(
    page.getByText("Sensor-only view", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/m5/workbench-stage1.png",
    fullPage: true,
  });
});

test("brain and sensor readings correspond to the exact selected decision", async ({
  page,
  context,
}) => {
  const ref = await context.newPage();
  await ref.goto("runtime.html");
  await ref.waitForFunction(() => !!window.m4);
  const expected = await ref.evaluate(async () => {
    const h = window.m4;
    await h.client.ready;
    const cp = await h.initialize({
        population: 16,
        ticks: 150,
        seed: "m5-case",
      }),
      source = h.reference(cp),
      genome = cp.population[0];
    await h.client.request({
      type: "openPlayback",
      playbackId: "reference",
      definition: {
        scenario: source.record.scenarios[0],
        controller: {
          kind: "neural",
          id: genome.id,
          parameters: genome.parameters,
        },
      },
    });
    const result = await h.client.request({
      type: "seekPlayback",
      playbackId: "reference",
      tick: 17,
    });
    await h.dispose();
    if (result.type !== "playback") throw new Error("Missing reference trace");
    return result.snapshot;
  });
  await ref.close();
  await create(page);
  await page
    .getByLabel("Playback tick", { exact: true })
    .evaluate((node: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(node, "17");
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await expect(page.locator(".decision-stamp")).toContainText("Body tick 17");
  await expect(page.locator(".decision-stamp")).toContainText("Decision 15");
  await expect(
    page.getByRole("button", { name: "H0: Hidden neuron", exact: true }),
  ).toHaveAttribute("data-activation", String(expected.decision!.hidden![0]));
  const magnitude = page.getByLabel("Minimum weight magnitude", {
    exact: true,
  });
  await magnitude.focus();
  await magnitude.press("Home");
  await expect(page.locator(".brain-graph line")).toHaveCount(264);
  await page.getByLabel("Focus neuron", { exact: true }).selectOption("H0");
  await expect(page.locator(".brain-graph line")).toHaveCount(22);
  await page
    .getByRole("button", { name: "H1: Hidden neuron", exact: true })
    .press("Enter");
  await expect(page.getByLabel("Focus neuron", { exact: true })).toHaveValue(
    "H1",
  );
  await page.getByRole("tab", { name: "Sensors", exact: true }).click();
  await page.getByText("All 20 input values", { exact: true }).click();
  for (let i = 0; i < 20; i++)
    await expect(page.getByTestId(`input-${i}`)).toHaveAttribute(
      "data-value",
      String(expected.decision!.inputs[i]),
    );
  await page.getByRole("tab", { name: "Measures", exact: true }).click();
  await expect(
    page.getByText("Episode in progress", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Brain", exact: true }).click();
  await expect(page.getByLabel("Focus neuron", { exact: true })).toHaveValue(
    "H1",
  );
  await page.screenshot({
    path: "artifacts/m5/workbench-desktop.png",
    fullPage: true,
  });
});

test("invalid drafts recover and presentation changes keep training reproducible", async ({
  page,
  context,
}) => {
  await create(page, "m5-preferences");
  await page.getByLabel("Food", { exact: true }).fill("201");
  await expect(page.locator(".field-error")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start new experiment", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Food", { exact: true }).fill("48");
  await expect(page.locator(".field-error")).toHaveCount(0);
  await page.getByLabel("Generations to train").fill("1");
  await page.getByLabel("Playback speed", { exact: true }).selectOption("4");
  await page.getByLabel("Sensor only", { exact: true }).check();
  await page
    .getByRole("button", { name: "Train 1 generation", exact: true })
    .click();
  await page.getByRole("button", { name: "Play trial", exact: true }).click();
  const champion = page.getByRole("button", { name: /Generation 0 champion/ });
  await expect(champion).toBeVisible();
  const actual = await champion.getAttribute("data-commit-id");
  const ref = await context.newPage();
  await ref.goto("runtime.html");
  await ref.waitForFunction(() => !!window.m4);
  const expected = await ref.evaluate(async () => {
    await window.m4.client.ready;
    const cp = await window.m4.initialize({
      population: 16,
      ticks: 150,
      seed: "m5-preferences",
    });
    const id = window.m4.reference(cp).id;
    await window.m4.dispose();
    return id;
  });
  await ref.close();
  expect(actual).toBe(expected);
});

test("mobile layout, reduced motion and keyboard playback are usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await create(page, "m5-mobile");
  await page.getByText("Experiment settings", { exact: true }).click();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Behavior, measured over generations",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Inspector", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Brain & observations", exact: true }),
  ).toBeVisible();
  await page.locator("#inspector-heading").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".decision-stamp")).toContainText("Decision 3");
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Pause trial", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Play trial", exact: true }),
  ).toBeVisible();
  const width = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport);
  await page.screenshot({
    path: "artifacts/m5/workbench-mobile.png",
    fullPage: true,
  });
});

test("fixed validation is reported separately after ten generations", async ({
  page,
}) => {
  await create(page, "m5-validation");
  await page
    .getByRole("button", { name: "Train 10 generations", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Generation 9 champion/ }),
  ).toBeVisible();
  await page.getByText("Generation measurements", { exact: true }).click();
  const row = page
    .locator("tbody tr")
    .filter({ has: page.locator("td:first-child", { hasText: /^9$/ }) });
  await expect(row).toHaveCount(1);
  await expect(row.locator("td").nth(3)).not.toHaveText("Not scheduled");
});

test("workbench has no automated WCAG A/AA violations in desktop and mobile inspection", async ({
  page,
}) => {
  await create(page, "m5-accessibility");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) {
      await page.getByRole("tab", { name: "Inspector", exact: true }).click();
    }
    for (const tab of ["Brain", "Sensors", "Measures"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        results.violations.map((v) => ({
          id: v.id,
          description: v.description,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    }
  }
  await page.screenshot({
    path: "artifacts/m5/workbench-mobile-final.png",
    fullPage: true,
  });
});

test("finished trials can be rewound and replacement controllers open paused", async ({
  page,
}) => {
  await create(page, "m5-terminal");
  await page.getByLabel("Playback speed", { exact: true }).selectOption("16");
  await page.getByRole("button", { name: "Play trial", exact: true }).click();
  await expect(page.locator(".playback-note")).toContainText("Episode ended");
  const timeline = page.getByLabel("Playback tick", { exact: true });
  await expect(timeline).toBeEnabled();
  await timeline.focus();
  await timeline.press("Home");
  await expect(page.locator(".decision-stamp")).toContainText("Body tick 0");
  await expect(
    page.getByRole("button", { name: "Play trial", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Selected controller", { exact: true })
    .selectOption({ index: 2 });
  await expect(
    page.getByRole("button", { name: "Step decision", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Play trial", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".decision-stamp")).toContainText("Body tick 1");
});
