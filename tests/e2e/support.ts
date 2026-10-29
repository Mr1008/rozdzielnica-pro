import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { createElectrician, createServiceClient, readStackEnv } from "../integration/support";
import { waitForIslands } from "./hydration";

/**
 * Shared steps of the e2e specs. Users are provisioned through the admin API of the stack that
 * `npx supabase status` reports — the local one, by construction — so neither a fresh clone nor CI
 * needs a hand-made account or a repository secret.
 */

export interface TestUser {
  email: string;
  password: string;
}

/** A confirmed `elektryk` (the default role of every new profile) with a unique email. */
export async function provisionElectrician(label: string): Promise<TestUser> {
  const { email, password } = await createElectrician(createServiceClient(readStackEnv()), label);
  return { email, password };
}

/**
 * Every POST goes through Astro's origin check, which refuses a form POST without the Origin a
 * browser would send. Send it — never relax the check.
 */
export function sameOrigin(baseURL: string | undefined): Record<string, string> {
  if (baseURL === undefined) throw new Error("baseURL is not configured (playwright.config.ts)");
  return { Origin: new URL(baseURL).origin };
}

/**
 * A browser context of its own, signed in as `user` through the real form endpoint — the same
 * cookie session the sign-in page produces. Close it in the test (or let the test end).
 */
export async function signedInContext(
  browser: Browser,
  baseURL: string | undefined,
  user: TestUser,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const res = await context.request.post("/api/auth/signin", {
    form: { email: user.email, password: user.password },
    headers: sameOrigin(baseURL),
    maxRedirects: 0,
  });
  expect(res.status()).toBe(302);
  expect(res.headers().location).not.toContain("/auth/signin");
  return context;
}

/** Opens a closed mounting group of the cabinet picker (a native `<details>`) by its label. */
export async function openCabinetGroup(page: Page, label: string): Promise<void> {
  const group = page.locator("details").filter({ has: page.locator("summary", { hasText: label }) });
  await group.locator("summary").click();
  await expect(group).toHaveAttribute("open", "");
}

/**
 * Creates a project in the seeded three-row cabinet and saves the supply every spec uses
 * (63 A, TN-S, one phase, Cu 16 mm², 10 m, surface). Leaves the page on the project, islands
 * hydrated. The new-project and supply forms are plain HTML (no island).
 */
export async function createProjectWithSupply(page: Page, name: string): Promise<{ id: string; url: string }> {
  await page.goto("/dashboard/projects/new");
  await page.getByLabel("Nazwa projektu").fill(name);
  // The picker's mounting groups start closed; the seeded cabinets are all surface-mounted.
  await openCabinetGroup(page, "Natynkowe");
  await page.getByRole("radio", { name: "Szafka natynkowa średnia, 3 rzędy" }).check();
  await page.getByRole("button", { name: "Załóż projekt" }).click();
  await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]{36}/);
  const url = new URL(page.url()).pathname;
  const id = url.split("/").at(-1);
  if (id === undefined) throw new Error(`no project id in ${url}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

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

  return { id, url };
}

/**
 * Adds one RCD group with two default circuits (16 A, one phase, 2,5 mm²) and saves them — on the
 * supply above, a fully matched set. Leaves the page on the saved result, islands hydrated.
 */
export async function saveMatchedGroup(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Dodaj grupę RCD" }).click();
  await page.getByRole("button", { name: "Dodaj obwód: Grupa RCD „RCD 1”" }).click();
  await page.getByRole("button", { name: "Dodaj obwód: Grupa RCD „RCD 1”" }).click();
  await page.getByRole("button", { name: "Zapisz obwody i dobierz aparaty" }).click();
  await page.waitForURL(/saved=circuits/);
  await waitForIslands(page);
}

/**
 * Deletes a project through the real endpoint and asserts it went through — a cleanup that fails
 * turns the run red. Call it from `afterEach`, so it runs even when the test fails mid-flow.
 */
export async function deleteProject(request: APIRequestContext, baseURL: string | undefined, id: string) {
  const res = await request.post(`/api/projects/${id}/delete`, {
    form: { confirm_delete: "on" },
    headers: sameOrigin(baseURL),
    maxRedirects: 0,
  });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toContain("deleted=1");
}
