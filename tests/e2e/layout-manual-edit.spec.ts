// risk: test-plan.md #4 — a manual layout edit must never store a physically impossible layout
//   (an MCB torn away from its RCD group); an accepted edit is what the project keeps.
//   facet: the S-06 editor → POST /api/projects/[id]/placements → stored placements → redrawn page.
//   Invariants of every move are unit-tested in src/lib/layout-editing.property.test.ts.
// seed: tests/e2e/seed.spec.ts
import { test, expect, type Page } from "@playwright/test";

import { createProjectWithSupply, deleteProject, saveMatchedGroup } from "./support";

/** A device on the layout drawing, by its full accessible name (name, DIN rail, position). */
function placedDevice(page: Page, name: string, rail: number, position: string) {
  return page.getByRole("button", {
    name: `Aparat „${name}”, szyna DIN ${String(rail)}, pozycja ${position} TE`,
    exact: true,
  });
}

test.describe("risk #4 — layout editing", () => {
  let projectId: string | undefined;
  let projectUrl = "";

  // Cleanup — runs even when the test goes red mid-flow, and asserts the delete went through.
  test.afterEach(async ({ page, baseURL }) => {
    if (projectId === undefined) return; // the project was never created
    await deleteProject(page.request, baseURL, projectId);
    projectId = undefined;
  });

  test("manual layout edit refuses an MCB torn from its RCD group and keeps only the accepted edit", async ({
    page,
  }) => {
    const projectName = `E2E edycja układu ${Date.now()}`;
    test.info().annotations.push({ type: "test-data", description: projectName });

    // Setup: a project with a supply and one RCD group of two 16 A circuits, so a layout is proposed.
    ({ id: projectId, url: projectUrl } = await createProjectWithSupply(page, projectName));
    await saveMatchedGroup(page);

    // The proposal puts the group's RCD at 3 TE and its MCBs right after it, on DIN rail 1.
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
