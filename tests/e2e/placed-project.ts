import { expect, type Page } from "@playwright/test";

import { waitForIslands } from "./hydration";

/**
 * Creates a project in the medium three-row cabinet and resolves with its page's path. Kept apart from
 * `addPlacedLayout` so a test can register the project for cleanup before the rest of the setup runs.
 */
export async function createProject(page: Page, projectName: string): Promise<string> {
  await page.goto("/dashboard/projects/new");
  await page.getByLabel("Nazwa projektu").fill(projectName);
  await page.getByRole("radio", { name: "Szafka natynkowa średnia, 3 rzędy" }).check();
  await page.getByRole("button", { name: "Załóż projekt" }).click();
  await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]{36}/);
  const projectUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();
  return projectUrl;
}

/**
 * On a fresh project's page: saves a supply and one RCD group of two 16 A circuits, so the circuit save
 * matches devices and stores a proposed (`placed`) layout. Resolves once the page is back from that save.
 */
export async function addPlacedLayout(page: Page): Promise<void> {
  await page.getByLabel("Zabezpieczenie przedlicznikowe").selectOption("63 A");
  await page.getByLabel("Układ sieci").selectOption("TN-S");
  await page.getByLabel("Liczba faz").selectOption("1 faza");
  await page.getByLabel("Długość WLZ (m)").fill("10");
  await page.getByLabel("Przekrój żył WLZ").selectOption("16 mm²");
  await page.getByLabel("Materiał żył").selectOption("Miedź (Cu)");
  await page.getByLabel("Sposób ułożenia").selectOption("Natynkowo");
  await page.getByRole("button", { name: "Zapisz przyłącze" }).click();
  await page.waitForURL(/saved=supply/);

  await waitForIslands(page);
  await page.getByRole("button", { name: "Dodaj grupę RCD" }).click();
  await page.getByRole("button", { name: "Dodaj obwód: Grupa RCD „RCD 1”" }).click();
  await page.getByRole("button", { name: "Dodaj obwód: Grupa RCD „RCD 1”" }).click();
  await page.getByRole("button", { name: "Zapisz obwody i dobierz aparaty" }).click();
  await page.waitForURL(/saved=circuits/);
}

/**
 * Deletes a project created by a test and asserts the delete went through. The endpoint is a form
 * POST guarded by Astro's origin check, so send the Origin a browser would.
 */
export async function deleteProject(page: Page, baseURL: string | undefined, projectUrl: string): Promise<void> {
  const res = await page.request.post(`/api/projects${projectUrl.slice("/dashboard/projects".length)}/delete`, {
    form: { confirm_delete: "on" },
    headers: { Origin: new URL(baseURL ?? page.url()).origin },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toContain("deleted=1");
}
