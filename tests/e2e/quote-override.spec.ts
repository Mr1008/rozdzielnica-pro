// risk: test-plan.md #5, #6 — the labour-time override endpoint (S-08 impl-review F7, test-plan §6.3):
//   it refuses an override with no pricing profile and with a match that is not current, stores the
//   estimate it recomputes itself as the override's base (never a value from the form), and lets the
//   electrician restore the estimate in every state. Another electrician's `not_found` is in
//   idor.spec.ts. The refusal and parse rules are unit-tested in src/lib/quote.test.ts; this proves
//   the real handler applies them.
//   facet: POST /api/projects/[id]/quote over the real session, the project page's quote section.
// seed: tests/e2e/seed.spec.ts
import { test, expect, type APIResponse, type BrowserContext } from "@playwright/test";

import { createServiceClient, readStackEnv } from "../integration/support";
import { waitForIslands } from "./hydration";
import {
  createProjectWithSupply,
  deleteProject,
  provisionElectrician,
  sameOrigin,
  saveMatchedGroup,
  signedInContext,
} from "./support";

// The profile this spec saves; the oracle below is the PRD's labour formula over these numbers.
const MOUNT_MINUTES = 15;
const OVERHEAD_MINUTES = 60;

/** The redirect's query, so `?error=` / `?saved=` can be asserted without the hash. */
function redirectQuery(res: APIResponse, baseURL: string | undefined): URLSearchParams {
  expect(res.status()).toBe(302);
  return new URL(res.headers().location, baseURL).searchParams;
}

test.describe("risk #5/#6 — the labour-time override endpoint", () => {
  // A throwaway electrician: whether a pricing profile exists is this spec's to decide.
  let electrician: BrowserContext | undefined;
  let projectId: string | undefined;

  test.afterEach(async ({ baseURL }) => {
    if (electrician !== undefined && projectId !== undefined) {
      await deleteProject(electrician.request, baseURL, projectId);
    }
    projectId = undefined;
    await electrician?.close();
    electrician = undefined;
  });

  test("refuses without a profile and on a stale match, stores the server's base, restores the estimate", async ({
    browser,
    baseURL,
  }) => {
    const projectName = `E2E nadpisanie czasu ${Date.now()}`;
    test.info().annotations.push({ type: "test-data", description: projectName });
    electrician = await signedInContext(browser, baseURL, await provisionElectrician("e2e-quote"));
    const page = await electrician.newPage();
    const service = createServiceClient(readStackEnv());

    ({ id: projectId } = await createProjectWithSupply(page, projectName));
    const id = projectId;
    await saveMatchedGroup(page);
    await expect(page.getByRole("heading", { name: "Dobrane aparaty" })).toBeVisible();

    const quote = (form: Record<string, string>) =>
      page.request.post(`/api/projects/${id}/quote`, { form, headers: sameOrigin(baseURL), maxRedirects: 0 });
    const setOverride = { intent: "set", labour_hours: "3", labour_minutes: "15" };
    const storedOverride = async () => {
      const { data, error } = await service
        .from("projects")
        .select("labour_minutes_override, labour_override_base_minutes")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    };

    // 1. No pricing profile: setting is refused — never an override over invented defaults — and
    //    restoring the estimate still works.
    expect(redirectQuery(await quote(setOverride), baseURL).get("error")).toBe("quote_pricing_not_configured");
    expect(redirectQuery(await quote({ intent: "clear" }), baseURL).get("saved")).toBe("quote");
    expect(await storedOverride()).toEqual({ labour_minutes_override: null, labour_override_base_minutes: null });

    // 2. With a profile but a match that is no longer stored (a supply change cleared it): setting is
    //    refused, restoring still works.
    const profile = await page.request.post("/api/profile/pricing", {
      form: {
        hourly_rate: "120",
        mount_minutes_per_device: String(MOUNT_MINUTES),
        project_overhead_minutes: String(OVERHEAD_MINUTES),
      },
      headers: sameOrigin(baseURL),
      maxRedirects: 0,
    });
    expect(redirectQuery(profile, baseURL).get("saved")).toBe("1");
    await page.goto(`/dashboard/projects/${id}`);
    await page.getByLabel("Długość WLZ (m)").fill("12");
    await page.getByRole("button", { name: "Zapisz przyłącze" }).click();
    await page.waitForURL(/saved=supply/);
    expect(redirectQuery(await quote(setOverride), baseURL).get("error")).toBe("quote_match_not_current");
    expect(redirectQuery(await quote({ intent: "clear" }), baseURL).get("saved")).toBe("quote");
    expect((await storedOverride()).labour_minutes_override).toBeNull();

    // 3. Current again: the override is stored with the base the server computed, not the forged one.
    //    Oracle (PRD quote formula): every stored snapshot row is a device; base = rows × mount + overhead.
    await waitForIslands(page);
    await page.getByRole("button", { name: "Dobierz ponownie" }).click();
    await page.waitForURL(/saved=rematch/);
    const forged = await quote({ ...setOverride, labour_override_base_minutes: "1" });
    expect(redirectQuery(forged, baseURL).get("saved")).toBe("quote");
    const { count, error } = await service
      .from("project_devices")
      .select("*", { count: "exact", head: true })
      .eq("project_id", id);
    if (error) throw error;
    expect(count).toBeGreaterThan(0);
    expect(await storedOverride()).toEqual({
      labour_minutes_override: 3 * 60 + 15,
      labour_override_base_minutes: (count ?? 0) * MOUNT_MINUTES + OVERHEAD_MINUTES,
    });
    await page.goto(`/dashboard/projects/${id}`);
    await expect(page.getByText("Nadpisany czas może być nieaktualny")).toBeHidden();

    // 4. The page's own "Przywróć estymację" removes the override.
    await page.getByRole("button", { name: "Przywróć estymację" }).click();
    await page.waitForURL(/saved=quote/);
    expect(await storedOverride()).toEqual({ labour_minutes_override: null, labour_override_base_minutes: null });
    await expect(page.getByRole("button", { name: "Przywróć estymację" })).toBeHidden();
  });
});
