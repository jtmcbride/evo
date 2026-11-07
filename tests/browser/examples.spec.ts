import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

async function library(page: import("@playwright/test").Page) {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "Create experiment", exact: true }),
  ).toBeEnabled();
  await page
    .getByText("Previously generated examples", { exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open evolved example", exact: true }),
  ).toBeEnabled();
}
async function seek(page: import("@playwright/test").Page) {
  await page
    .getByLabel("Playback tick", { exact: true })
    .evaluate((node: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(node, "17");
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await expect(page.locator(".decision-stamp")).toContainText("Decision 15");
}
test("bundled examples load under the repository base, preserve local saves and replay after reload", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByLabel("Population", { exact: true }).fill("16");
  await page.getByLabel("Episode seconds", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Create experiment", exact: true })
    .click();
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 0",
  );
  const original = await page
    .getByLabel("Saved experiments", { exact: true })
    .inputValue();
  await page
    .getByText("Previously generated examples", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open evolved example", exact: true })
    .click();
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 200",
  );
  await expect(
    page.getByRole("heading", {
      name: "Previously generated · generation 199",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Saved experiments", { exact: true })
      .locator(`option[value="${original}"]`),
  ).toHaveCount(1);
  await seek(page);
  const activation = await page
    .getByRole("button", { name: "H0: Hidden neuron", exact: true })
    .getAttribute("data-activation");
  await page.reload();
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 200",
  );
  await seek(page);
  await expect(
    page.getByRole("button", { name: "H0: Hidden neuron", exact: true }),
  ).toHaveAttribute("data-activation", activation!);
  await page
    .getByText("Previously generated examples", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open initial example", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Previously generated · generation 0",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 0",
  );
  await page
    .getByLabel("Saved experiments", { exact: true })
    .selectOption(original);
  await expect(
    page.getByRole("heading", { name: "Initial controller", exact: true }),
  ).toBeVisible();
});

test("a corrupted bundled archive is rejected before creating or replacing a save", async ({
  page,
}) => {
  await library(page);
  await page.route("**/examples/final.evolab", (route) =>
    route.fulfill({
      body: "corrupted example",
      contentType: "application/zip",
    }),
  );
  await page
    .getByRole("button", { name: "Open evolved example", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Example checksum mismatch",
  );
  await expect(
    page.getByLabel("Saved experiments", { exact: true }).locator("option"),
  ).toHaveCount(1);
  await expect(page.locator(".save-status strong")).toHaveText(
    "No saved experiment selected",
  );
});

test("bundled example controls are accessible on desktop and mobile", async ({
  page,
}) => {
  await library(page);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("a delayed example download does not replace an experiment that advanced meanwhile", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByLabel("Population", { exact: true }).fill("16");
  await page.getByLabel("Episode seconds", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Create experiment", exact: true })
    .click();
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 0",
  );
  const original = await page
    .getByLabel("Saved experiments", { exact: true })
    .inputValue();
  await page
    .getByText("Previously generated examples", { exact: true })
    .click();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/examples/final.evolab", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Open evolved example", exact: true })
    .click();
  await page.getByLabel("Generations to train").fill("1");
  await page
    .getByRole("button", { name: "Train 1 generation", exact: true })
    .click();
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 1",
  );
  release();
  await expect(page.getByRole("alert")).toContainText("experiment changed");
  await expect(
    page.getByLabel("Saved experiments", { exact: true }),
  ).toHaveValue(original);
  await expect(page.locator(".save-status strong")).toHaveText(
    "Saved population 1",
  );
});
