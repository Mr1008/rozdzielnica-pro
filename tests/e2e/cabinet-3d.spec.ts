// smoke: the 3D preview (GitHub #14) — the lazily loaded scene mounts a WebGL canvas over a placed
//   layout. Catches a broken lazy import or island mount, which the unit tests cannot see; the scene
//   model and the wire lift are unit-tested in src/lib/cabinet-3d.test.ts and src/lib/wiring-3d.test.ts.
// seed: tests/e2e/seed.spec.ts
import { test, expect } from "@playwright/test";

import { waitForIslands } from "./hydration";
import { addPlacedLayout, createProject, deleteProject } from "./placed-project";

test.describe("3D preview", () => {
  let projectUrl: string | undefined;

  // Cleanup — runs even when the test goes red mid-flow, and asserts the delete went through.
  test.afterEach(async ({ page, baseURL }) => {
    if (projectUrl === undefined) return; // the project was never created
    await deleteProject(page, baseURL, projectUrl);
    projectUrl = undefined;
  });

  test("a placed layout's 3D view mounts its canvas with no errors", async ({ page }) => {
    const projectName = `E2E podgląd 3D ${Date.now()}`;
    test.info().annotations.push({ type: "test-data", description: projectName });

    projectUrl = await createProject(page, projectName);
    await addPlacedLayout(page);

    // Collected from here on: the 3D page load is what this smoke covers.
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(`${projectUrl}?wiring=3d#layout`);
    await waitForIslands(page);

    await expect(page.getByRole("img", { name: /Trójwymiarowy podgląd rozdzielnicy/ })).toBeVisible();
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByText("Podgląd 3D jest niedostępny")).toHaveCount(0);
    // The scene chunk loads lazily and the wires are routed and lifted after the first render; wait
    // for both, so an error from either lands before the console check.
    await expect(page.getByText("Ładowanie podglądu 3D…")).toHaveCount(0);
    await expect(page.getByText("Wczytywanie przewodów…")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
