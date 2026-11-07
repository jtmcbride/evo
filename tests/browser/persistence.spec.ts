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
