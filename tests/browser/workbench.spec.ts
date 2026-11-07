import { test, expect } from "@playwright/test";
async function create(page: import("@playwright/test").Page, seed = "m5-case") {
  await page.goto("./");
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
