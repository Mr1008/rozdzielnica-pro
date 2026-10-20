// risk: test-plan.md #4 — a manual layout edit must never store a physically impossible layout
//   (an MCB torn away from its RCD group); an accepted edit is what the project keeps.
//   facet: the S-06 editor → POST /api/projects/[id]/placements → stored placements → redrawn page.
//   Invariants of every move are unit-tested in src/lib/layout-editing.property.test.ts.
// seed: tests/e2e/seed.spec.ts
import { test, expect, type Page } from "@playwright/test";

import { waitForIslands } from "./hydration";

/** A device on the layout drawing, by its full accessible name (name, DIN rail, position). */
function placedDevice(page: Page, name: string, rail: number, position: string) {
  return page.getByRole("button", {
    name: `Aparat „${name}”, szyna DIN ${String(rail)}, pozycja ${position} TE`,
    exact: true,
  });
}

test.describe("risk #4 — layout editing", () => {
  let projectUrl: string | undefined;

  // Cleanup — runs even when the test goes red mid-flow, and asserts the delete went through. The
  // endpoint is a form POST guarded by Astro's origin check, so send the Origin a browser would.
  test.afterEach(async ({ page, baseURL }) => {
    if (projectUrl === undefined) return; // the project was never created
    const res = await page.request.post(`/api/projects${projectUrl.slice("/dashboard/projects".length)}/delete`, {
      form: { confirm_delete: "on" },
      headers: { Origin: new URL(baseURL ?? page.url()).origin },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toContain("deleted=1");
    projectUrl = undefined;
  });

  test("manual layout edit refuses an MCB torn from its RCD group and keeps only the accepted edit", async ({
    page,
  }) => {
    const projectName = `E2E edycja układu ${Date.now()}`;
    test.info().annotations.push({ type: "test-data", description: projectName });

    // Setup: a project with a supply and one RCD group of two 16 A circuits, so a layout is proposed.
    await page.goto("/dashboard/projects/new");
    await page.getByLabel("Nazwa projektu").fill(projectName);
    await page.getByRole("radio", { name: "Szafka natynkowa średnia, 3 rzędy" }).check();
    await page.getByRole("button", { name: "Załóż projekt" }).click();
    await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]{36}/);
    projectUrl = new URL(page.url()).pathname;
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

    await waitForIslands(page);
    await page.getByRole("button", { name: "Dodaj grupę RCD" }).click();
    await page.getByRole("button", { name: "Dodaj obwód: Grupa RCD „RCD 1”" }).click();
    await page.getByRole("button", { name: "Dodaj obwód: Grupa RCD „RCD 1”" }).click();
    await page.getByRole("button", { name: "Zapisz obwody i dobierz aparaty" }).click();
    await page.waitForURL(/saved=circuits/);

    // The proposal puts the group's RCD at 3 TE and its MCBs right after it, on DIN rail 1.
    await waitForIslands(page);
    await expect(placedDevice(page, "RCD 40A 30mA RCD 1", 1, "3")).toBeVisible();
    await expect(placedDevice(page, "B16 Obwód 1", 1, "5")).toBeVisible();
    await expect(placedDevice(page, "B16 Obwód 2", 1, "6")).toBeVisible();
    const editorStatus = page.getByRole("group", { name: "Edytor układu aparatów w szafce" }).getByRole("status");

    // Refused edit: lift "B16 Obwód 2" (keyboard: space), move it down to DIN rail 2 and drop it there.
    // It would leave its RCD group, so the drop is refused; Escape puts it back.
    await placedDevice(page, "B16 Obwód 2", 1, "6").focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(editorStatus).toContainText("Nie można upuścić: aparat „B16 Obwód 2”");
    await page.keyboard.press("Escape");
    await expect(placedDevice(page, "B16 Obwód 2", 1, "6")).toBeVisible();

    // Accepted edit: swap the two MCBs inside the group (two half-module steps left) and save.
    await placedDevice(page, "B16 Obwód 2", 1, "6").focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await expect(placedDevice(page, "B16 Obwód 2", 1, "5")).toBeVisible();
    await page.getByRole("button", { name: "Zapisz układ" }).click();
    await page.waitForURL(/saved=layout_edited/);

    // Assertion: a fresh load draws the stored layout — the accepted swap, both MCBs still on rail 1
    // next to their RCD, marked as manually edited; the refused move left nothing behind.
    await page.goto(projectUrl);
    await expect(placedDevice(page, "RCD 40A 30mA RCD 1", 1, "3")).toBeVisible();
    await expect(placedDevice(page, "B16 Obwód 2", 1, "5")).toBeVisible();
    await expect(placedDevice(page, "B16 Obwód 1", 1, "6")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Aparat „B16 Obwód \d”, szyna DIN 2,/ })).toHaveCount(0);
    await expect(page.getByText("Poprawiony ręcznie").first()).toBeVisible();
  });
});
