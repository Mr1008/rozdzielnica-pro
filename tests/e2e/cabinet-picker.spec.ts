// The cabinet picker at catalog scale (change catalog-pickers): mounting groups start closed, the
// filters run in the browser without a reload, and neither a filter nor a closed group may hide the
// required choice. Runs on the local catalog: the seeded sample cabinets (all surface) plus the
// Karwasz migration, whose RP-* cabinets are the flush ones. Nothing here is written.
import { test, expect, type Page } from "@playwright/test";

import { openCabinetGroup } from "./support";

const surfaceGroup = (page: Page) =>
  page.locator("details").filter({ has: page.locator("summary", { hasText: "Natynkowe" }) });
const flushGroup = (page: Page) =>
  page.locator("details").filter({ has: page.locator("summary", { hasText: "Podtynkowe" }) });

test.beforeEach(async ({ page }) => {
  await page.goto("/dashboard/projects/new");
});

test("filtering by mounting and module count narrows the picker without a reload", async ({ page }) => {
  await expect(surfaceGroup(page)).not.toHaveAttribute("open");
  await expect(flushGroup(page)).not.toHaveAttribute("open");

  await page.getByLabel("Rodzaj montażu").selectOption("Podtynkowa");
  await page.getByLabel("Min. liczba modułów").fill("24");

  await expect(flushGroup(page)).toHaveAttribute("open", "");
  await expect(surfaceGroup(page)).toBeHidden();
  await expect(page.getByRole("radio", { name: /RP-24,/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /RP-12-P,/ })).toBeHidden();

  await page.getByLabel("Szukaj").fill("nie ma takiej szafki");
  await expect(page.getByText("Nic nie pasuje do filtrów. Zmień je lub wyczyść.")).toBeVisible();

  await page.getByRole("button", { name: "Wyczyść filtry" }).click();
  await expect(surfaceGroup(page)).toBeVisible();
  await expect(page.getByLabel("Min. liczba modułów")).toHaveValue("");
});

test("the checked cabinet stays visible under a filter that excludes it", async ({ page }) => {
  await openCabinetGroup(page, "Natynkowe");
  const small = page.getByRole("radio", { name: "Szafka natynkowa mała, 1 rząd" });
  await small.check();

  await page.getByLabel("Min. liczba modułów").fill("50");

  await expect(small).toBeVisible();
  await expect(small).toBeChecked();
  await expect(page.getByRole("radio", { name: /RN-24,/ })).toBeHidden();
});

test("a cabinet chosen under a filter keeps its group open once the filters clear", async ({ page }) => {
  await page.getByLabel("Rodzaj montażu").selectOption("Podtynkowa");
  const rp24 = page.getByRole("radio", { name: /RP-24,/ });
  await rp24.check();

  await page.getByRole("button", { name: "Wyczyść filtry" }).click();

  await expect(flushGroup(page)).toHaveAttribute("open", "");
  await expect(rp24).toBeVisible();
  await expect(rp24).toBeChecked();
});

test("submitting with no cabinet opens the groups instead of failing silently", async ({ page }) => {
  await page.getByLabel("Nazwa projektu").fill(`E2E bez szafki ${Date.now()}`);
  await page.getByLabel("Min. liczba modułów").fill("1000");
  await expect(page.getByText("Nic nie pasuje do filtrów. Zmień je lub wyczyść.")).toBeVisible();

  await page.getByRole("button", { name: "Załóż projekt" }).click();

  await expect(page).toHaveURL(/\/dashboard\/projects\/new$/);
  await expect(page.getByLabel("Min. liczba modułów")).toHaveValue("");
  await expect(surfaceGroup(page)).toHaveAttribute("open", "");
  await expect(flushGroup(page)).toHaveAttribute("open", "");
  const first = page.getByRole("radio").first();
  await expect(first).toBeVisible();
  expect(await first.evaluate((radio: HTMLInputElement) => radio.validity.valueMissing)).toBe(true);
});

test("the chosen view survives a reload", async ({ page }) => {
  const list = page.getByRole("button", { name: "Lista" });
  await list.click();
  await expect(list).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.getByRole("button", { name: "Lista" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Małe" })).toHaveAttribute("aria-pressed", "false");
});
