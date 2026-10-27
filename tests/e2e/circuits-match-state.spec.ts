// risk: test-plan.md #2 — the domain decides correctly, but the electrician must also *see* it:
//   saved circuits come back without loss, and after a supply change the page must say the stored
//   device set is gone and offer "Dobierz ponownie" — never keep showing the old set as current.
//   Challenges "the endpoint calls the parser and the matcher, so the UI is OK".
//   facet: circuit editor → POST circuits → reload (round-trip) → POST supply (the snapshot-clearing
//   trigger) → the `cleared` marker → POST rematch → `current` again.
//   Not here, by design: the catalog-gap error (seed.spec.ts) and catalog-drift `stale`
//   (src/lib/device-matching-server.test.ts) — the page renders `stale` through the same alert.
// seed: tests/e2e/seed.spec.ts
import { test, expect, type Page } from "@playwright/test";

import { waitForIslands } from "./hydration";
import { createProjectWithSupply, deleteProject } from "./support";

const GROUP = "Kuchnia";
const CIRCUITS = ["Gniazda blat", "Zmywarka"] as const;

/** Every field the electrician set, read back from the stored state. Selects hold option values. */
async function expectCircuitsAsSaved(page: Page) {
  const group = page.getByRole("listitem", { name: `Grupa RCD „${GROUP}”` });
  await expect(group.getByLabel("Nazwa grupy")).toHaveValue(GROUP);
  await expect(group.getByLabel("Prąd różnicowy IΔn")).toHaveValue("30");
  await expect(group.getByLabel("Minimalny typ RCD")).toHaveValue("AC");
  await expect(group.getByLabel("Zapas prądu RCD")).toHaveValue("20");

  const [first, second] = CIRCUITS.map((name) => page.getByRole("listitem", { name: `Obwód „${name}”` }));
  for (const [row, name] of [
    [first, CIRCUITS[0]],
    [second, CIRCUITS[1]],
  ] as const) {
    await expect(row.getByLabel("Nazwa obwodu")).toHaveValue(name);
    await expect(row.getByLabel("Prąd znamionowy In")).toHaveValue("16");
    await expect(row.getByLabel("Liczba faz")).toHaveValue("1");
    await expect(row.getByLabel("Przekrój przewodu")).toHaveValue("2.5");
  }
  await expect(first.getByLabel("Sposób ułożenia")).toHaveValue("surface");
  await expect(first.getByLabel("Wprowadzenie przewodów")).toHaveValue("bottom");
  await expect(second.getByLabel("Sposób ułożenia")).toHaveValue("conduit_surface");
  await expect(second.getByLabel("Wprowadzenie przewodów")).toHaveValue("top");
}

test.describe("risk #2 — match state on the project page", () => {
  let projectId: string | undefined;

  test.afterEach(async ({ page, baseURL }) => {
    if (projectId === undefined) return;
    await deleteProject(page.request, baseURL, projectId);
    projectId = undefined;
  });

  test("saved circuits come back intact; a supply change shows 'Dobierz ponownie' until re-matched", async ({
    page,
  }) => {
    const projectName = `E2E stan doboru ${Date.now()}`;
    test.info().annotations.push({ type: "test-data", description: projectName });
    const rematch = page.getByRole("button", { name: "Dobierz ponownie" });
    const matched = page.getByRole("heading", { name: "Dobrane aparaty" });
    const aside = page.getByRole("complementary");

    // Setup: a project with a supply; one group of two 16 A circuits — a fully matching set on it —
    // with a non-default value in every field the defaults would otherwise hide a loss behind.
    ({ id: projectId } = await createProjectWithSupply(page, projectName));
    await page.getByRole("button", { name: "Dodaj grupę RCD" }).click();
    const group = page.getByRole("listitem", { name: "Grupa RCD „RCD 1”" });
    await group.getByLabel("Minimalny typ RCD").selectOption("AC");
    await group.getByLabel("Zapas prądu RCD").selectOption("20");
    await group.getByLabel("Nazwa grupy").fill(GROUP);
    await page.getByRole("button", { name: `Dodaj obwód: Grupa RCD „${GROUP}”` }).click();
    await page.getByRole("button", { name: `Dodaj obwód: Grupa RCD „${GROUP}”` }).click();
    const first = page.getByRole("listitem", { name: "Obwód „Obwód 1”" });
    await first.getByLabel("Sposób ułożenia").selectOption("surface");
    await first.getByLabel("Wprowadzenie przewodów").selectOption("bottom");
    await first.getByLabel("Nazwa obwodu").fill(CIRCUITS[0]);
    const second = page.getByRole("listitem", { name: "Obwód „Obwód 2”" });
    await second.getByLabel("Sposób ułożenia").selectOption("conduit_surface");
    await second.getByLabel("Nazwa obwodu").fill(CIRCUITS[1]);
    await page.getByRole("button", { name: "Zapisz obwody i dobierz aparaty" }).click();
    await page.waitForURL(/saved=circuits/);

    // 1. Round-trip and `current`: a fresh load (not the save response) shows every saved value and
    //    the stored device set, with no re-match marker and no gap.
    await page.reload();
    await waitForIslands(page);
    await expectCircuitsAsSaved(page);
    await expect(matched).toBeVisible();
    await expect(rematch).toBeHidden();
    await expect(page.getByRole("heading", { name: "Luki w katalogu aparatów" })).toBeHidden();
    await expect(aside).not.toContainText("Nieaktualny");

    // 2. A supply change deletes the stored set: the page must say so and offer the re-match, and the
    //    circuits themselves survive. Only the WLZ length changes, so the circuits stay matchable —
    //    re-saving identical values would clear nothing.
    await page.getByLabel("Długość WLZ (m)").fill("12");
    await page.getByRole("button", { name: "Zapisz przyłącze" }).click();
    await page.waitForURL(/saved=supply/);
    await page.reload();
    await waitForIslands(page);
    const marker = page.getByRole("status").filter({ has: rematch });
    await expect(marker).toContainText("Projekt nie ma zapisanego doboru aparatów");
    await expect(aside).toContainText("Nieaktualny");
    await expect(page.getByRole("heading", { name: "Podgląd nowego doboru (niezapisany)" })).toBeVisible();
    await expectCircuitsAsSaved(page);

    // 3. Re-matching stores the set again: `current`, no marker.
    await rematch.click();
    await page.waitForURL(/saved=rematch/);
    await page.reload();
    await waitForIslands(page);
    await expect(matched).toBeVisible();
    await expect(rematch).toBeHidden();
    await expect(aside).not.toContainText("Nieaktualny");
  });
});
