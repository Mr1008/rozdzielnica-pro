// Seed — the pattern every generated E2E test copies.
// Risk #2 (context/foundation/test-plan.md): the domain is right but the electrician sees something
// else — here, a catalog gap must reach the project page as an error, never as a substitute device.
// The local seed catalog (supabase/seed.sql) deliberately has no B40 MCB.
import { test, expect } from "@playwright/test";

import { waitForIslands } from "./hydration";

let projectId: string | undefined;

// Cleanup — in afterEach, so it runs even when the test goes red mid-flow, and asserted, so a cleanup
// that fails turns the run red. The delete endpoint is a form POST behind Astro's origin check: send
// the Origin a browser would, never relax the check.
test.afterEach(async ({ page, baseURL }) => {
  if (projectId === undefined) return; // the project was never created
  const res = await page.request.post(`/api/projects/${projectId}/delete`, {
    form: { confirm_delete: "on" },
    headers: { Origin: new URL(baseURL ?? page.url()).origin },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toContain("deleted=1");
  projectId = undefined;
});

test("catalog gap shows on the project page as an error, never as a substitute device (risk #2)", async ({ page }) => {
  const projectName = `E2E luka katalogu ${Date.now()}`;
  test.info().annotations.push({ type: "test-data", description: projectName });

  // Setup: a project with a configured supply. The new-project form is plain HTML (no island).
  await page.goto("/dashboard/projects/new");
  await page.getByLabel("Nazwa projektu").fill(projectName);
  await page.getByRole("radio", { name: "Szafka natynkowa średnia, 3 rzędy" }).check();
  await page.getByRole("button", { name: "Załóż projekt" }).click();
  await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]{36}/);
  projectId = new URL(page.url()).pathname.split("/").at(-1);
  await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();

  await page.getByLabel("Zabezpieczenie przedlicznikowe").selectOption("63 A");
  await page.getByLabel("Układ sieci").selectOption("TN-S");
  await page.getByLabel("Liczba faz").selectOption("1 faza");
  await page.getByLabel("Długość WLZ (m)").fill("10");
  await page.getByLabel("Przekrój żył WLZ").selectOption("16 mm²");
  await page.getByLabel("Materiał żył").selectOption("Miedź (Cu)");
  await page.getByLabel("Sposób ułożenia").selectOption("Natynkowo");
  await page.getByRole("button", { name: "Zapisz przyłącze" }).click();
  await page.waitForURL(/saved=supply/);

  // Action: one 40 A circuit. The circuit editor is a client-only React island — wait for it to
  // hydrate before the first input, because saving circuits is not something to retry blindly.
  await waitForIslands(page);
  await page.getByRole("button", { name: "Dodaj obwód: Bez grupy" }).click();
  const circuit = page.getByRole("listitem", { name: "Obwód „Obwód 1”" });
  await circuit.getByLabel("Prąd znamionowy In").selectOption("40 A");
  await circuit.getByLabel("Przekrój przewodu").selectOption("10 mm²");
  await circuit.getByLabel("Sposób ułożenia").selectOption("Natynkowo");
  await page.getByRole("button", { name: "Zapisz obwody i dobierz aparaty" }).click();
  await page.waitForURL(/saved=circuits/);

  // Assertion: the gap names the missing device and the circuit, tells the user to contact the
  // admin, and no device set is proposed — a silently substituted device (an under-rated B32, or a
  // B50 once the catalog has one) would show "Dobrane aparaty" instead. Reload first, so this is the
  // stored state, not the save response.
  await page.reload();
  const gap = page.getByRole("status").filter({ has: page.getByRole("heading", { name: "Luki w katalogu aparatów" }) });
  await expect(gap).toContainText("wyłącznik nadprądowy B40");
  await expect(gap).toContainText("obwód: „Obwód 1”");
  await expect(gap).toContainText("Skontaktuj się z administratorem");
  await expect(page.getByRole("heading", { name: "Dobrane aparaty" })).toBeHidden();
});
