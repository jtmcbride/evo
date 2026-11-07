import { test, expect, type Page } from "@playwright/test";
async function study(
  page: Page,
  seed = "m6-save",
  population = 16,
  seconds = 5,
) {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "Create experiment", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Random seed", { exact: true }).fill(seed);
  await page.getByLabel("Population", { exact: true }).fill(String(population));
  await page
    .getByLabel("Episode seconds", { exact: true })
    .fill(String(seconds));
  await page
    .getByRole("button", { name: "Create experiment", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Initial controller", exact: true }),
  ).toBeVisible();
}
async function train(page: Page, count: number) {
  await page.getByLabel("Generations to train").fill(String(count));
  await page
    .getByRole("button", {
      name: `Train ${count} generation${count === 1 ? "" : "s"}`,
      exact: true,
    })
    .click();
}
test("reload resumes the saved population and preserves deterministic continuation", async ({
  page,
  context,
}) => {
  const ref = await context.newPage();
  await ref.goto("runtime.html");
  await ref.waitForFunction(() => !!window.m4);
  const expected = await ref.evaluate(async () => {
    await window.m4.client.ready;
    const cp = await window.m4.initialize({
        population: 16,
        ticks: 150,
        seed: "m6-save",
      }),
      first = window.m4.reference(cp),
      second = window.m4.reference(first.nextCheckpoint);
    await window.m4.dispose();
    return [first.id, second.id];
  });
  await ref.close();
  await study(page);
  await train(page, 1);
  await expect(
    page.getByRole("button", { name: /Generation 0 champion/ }),
  ).toHaveAttribute("data-commit-id", expected[0]);
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 1",
  );
  await page.reload();
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 1",
  );
  await expect(
    page.getByRole("button", { name: /Generation 0 champion/ }),
  ).toBeVisible();
  await train(page, 1);
  await expect(
    page.getByRole("button", { name: /Generation 1 champion/ }),
  ).toHaveAttribute("data-commit-id", expected[1]);
});
test("an interrupted generation recovers paused at the previous durable population", async ({
  page,
}) => {
  await study(page, "m6-interrupted", 128, 60);
  await train(page, 10);
  await expect
    .poll(() =>
      page
        .getByRole("progressbar", { name: "Generation trial progress" })
        .getAttribute("value"),
    )
    .not.toBe("0");
  await page.reload();
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 0",
  );
  await expect(page.locator(".storage-notice")).toContainText(
    "unfinished generation will rerun",
  );
  await expect(
    page.getByRole("button", { name: "Train 10 generations", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Pause training", exact: true }),
  ).toHaveCount(0);
});

test("portable export/import creates a separate save and continues the same population", async ({
  page,
  browser,
}, info) => {
  await study(page, "m6-archive");
  await train(page, 1);
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 1",
  );
  const pendingDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export checkpoint", exact: true })
    .click();
  const download = await pendingDownload,
    path = info.outputPath("checkpoint.evolab");
  await download.saveAs(path);
  const sourceId = await page
    .getByLabel("Saved experiments", { exact: true })
    .inputValue();
  await page
    .getByLabel("Checkpoint archive", { exact: true })
    .setInputFiles(path);
  await expect(
    page.getByLabel("Saved experiments", { exact: true }).locator("option"),
  ).toHaveCount(3);
  expect(
    await page.getByLabel("Saved experiments", { exact: true }).inputValue(),
  ).not.toBe(sourceId);
  const context = await browser.newContext(),
    imported = await context.newPage();
  try {
    await imported.goto("http://127.0.0.1:4173/evo/");
    await expect(
      imported.getByRole("button", { name: "Import checkpoint", exact: true }),
    ).toBeEnabled();
    await imported
      .getByLabel("Checkpoint archive", { exact: true })
      .setInputFiles(path);
    await expect(imported.locator(".save-status strong")).toHaveText(
      "Saved population 1",
    );
    await train(imported, 1);
    await expect(
      imported.getByRole("button", { name: /Generation 1 champion/ }),
    ).toBeVisible();
    const actual = await imported
      .getByRole("button", { name: /Generation 1 champion/ })
      .getAttribute("data-commit-id");
    await train(page, 1);
    await expect(
      page.getByRole("button", { name: /Generation 1 champion/ }),
    ).toHaveAttribute("data-commit-id", actual!);
  } finally {
    await context.close();
  }
});

test("an invalid import leaves the current experiment and saved library intact", async ({
  page,
}) => {
  await study(page, "m6-bad-import");
  const selected = await page
    .getByLabel("Saved experiments", { exact: true })
    .inputValue();
  await page
    .getByLabel("Checkpoint archive", { exact: true })
    .setInputFiles({
      name: "broken.evolab",
      mimeType: "application/zip",
      buffer: Buffer.from("not a checkpoint"),
    });
  await expect(page.getByRole("alert")).toContainText("truncated");
  await expect(
    page.getByLabel("Saved experiments", { exact: true }),
  ).toHaveValue(selected);
  await expect(
    page.getByLabel("Saved experiments", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Train 10 generations", exact: true }),
  ).toBeEnabled();
});
