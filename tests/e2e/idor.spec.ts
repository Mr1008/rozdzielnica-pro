// risk: test-plan.md #6 — electrician B must never read or change electrician A's project through
//   an id in a URL or a form. Challenges "there is RLS, so the endpoint is secure": RLS makes A's
//   rows invisible to B (proven per table in tests/integration/rls-*.test.ts), but only the page or
//   handler decides what an invisible row becomes. Here: a 404 with no data, and a `not_found`
//   redirect with no write — never a success redirect over zero changed rows.
//   facet: B's session → GET both project pages, POST every /api/projects/[id]/* endpoint with a
//   body the endpoint accepts → A re-reads an unchanged project.
// seed: tests/e2e/seed.spec.ts
import { randomUUID } from "node:crypto";

import { test, expect, type BrowserContext, type Page } from "@playwright/test";

import { waitForIslands } from "./hydration";
import {
  createProjectWithSupply,
  deleteProject,
  provisionElectrician,
  sameOrigin,
  saveMatchedGroup,
  signedInContext,
} from "./support";

/**
 * The fields a form on A's own page would post, read from the live DOM — a body the endpoint
 * accepts by construction. Several handlers validate the body before they look the project up, so an
 * empty body would prove validation, not ownership.
 */
async function formFields(page: Page, actionSuffix: string): Promise<Record<string, string>> {
  return page.evaluate((suffix) => {
    const form = [...document.querySelectorAll("form")].find((f) => f.getAttribute("action")?.endsWith(suffix));
    if (!form) throw new Error(`no form posting to *${suffix}`);
    const fields: Record<string, string> = {};
    for (const [key, value] of new FormData(form)) if (typeof value === "string") fields[key] = value;
    return fields;
  }, actionSuffix);
}

test.describe("risk #6 — another electrician's project", () => {
  let projectId: string | undefined;
  let intruder: BrowserContext | undefined;

  test.afterEach(async ({ page, baseURL }) => {
    await intruder?.close();
    intruder = undefined;
    // A's own delete must still succeed — B's delete attempt below left the project in place.
    if (projectId === undefined) return;
    await deleteProject(page.request, baseURL, projectId);
    projectId = undefined;
  });

  test("electrician B gets not-found for A's project pages and endpoints, and A's project is unchanged", async ({
    page,
    browser,
    baseURL,
  }) => {
    const projectName = `E2E IDOR ${Date.now()}`;
    test.info().annotations.push({ type: "test-data", description: projectName });

    // Setup as A (the default session): a project with a supply and a matched RCD group.
    ({ id: projectId } = await createProjectWithSupply(page, projectName));
    const id = projectId;
    await saveMatchedGroup(page);
    await expect(page.getByRole("heading", { name: "Dobrane aparaty" })).toBeVisible();

    // A's own forms, as B would forge them — each with one value changed, so a write would show.
    const details = { ...(await formFields(page, `/${id}`)), name: "Przejęty przez B" };
    const supply = { ...(await formFields(page, `/${id}/supply`)), wlz_length_m: "99" };
    const cabinet = await formFields(page, `/${id}/cabinet`);
    const circuits = await formFields(page, `/${id}/circuits`);
    expect(circuits.circuits_payload).toContain("Obwód 1");

    // Electrician B, a separate account with its own session.
    intruder = await signedInContext(browser, baseURL, await provisionElectrician("e2e-b"));
    const asB = intruder.request;

    // Pages: a 404 that carries nothing of A's project.
    for (const path of [`/dashboard/projects/${id}`, `/dashboard/projects/${id}/print`]) {
      const res = await asB.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(404);
      const body = await res.text();
      expect(body, path).toContain("Nie znaleziono tego projektu");
      expect(body, path).not.toContain(projectName);
    }

    // Endpoints: every one refuses with `not_found` — delete last, so the others hit a live project.
    const attempts: [string, Record<string, string>][] = [
      ["", details],
      ["/supply", supply],
      ["/cabinet", cabinet],
      ["/circuits", circuits],
      ["/rematch", {}],
      ["/layout", {}],
      [
        "/placements",
        { placements_payload: JSON.stringify([{ projectDeviceId: randomUUID(), railIndex: 0, xMm: 0 }]) },
      ],
      ["/quote", { intent: "set", labour_hours: "1", labour_minutes: "0" }],
      ["/quote", { intent: "clear" }],
      ["/delete", { confirm_delete: "on" }],
    ];
    for (const [suffix, form] of attempts) {
      const res = await asB.post(`/api/projects/${id}${suffix}`, {
        form,
        headers: sameOrigin(baseURL),
        maxRedirects: 0,
      });
      const label = `POST /api/projects/[id]${suffix} ${JSON.stringify(form).slice(0, 40)}`;
      expect(res.status(), label).toBe(302);
      const location = new URL(res.headers().location, baseURL);
      expect(location.pathname + location.search, label).toBe("/dashboard/projects?error=not_found");
    }

    // A re-reads the stored project: name, supply, circuits and the match are as A left them.
    await page.goto(`/dashboard/projects/${id}`);
    await waitForIslands(page);
    await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();
    await expect(page.getByLabel("Długość WLZ (m)")).toHaveValue("10");
    await expect(page.getByRole("listitem", { name: "Obwód „Obwód 1”" })).toBeVisible();
    await expect(page.getByRole("listitem", { name: "Obwód „Obwód 2”" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dobrane aparaty" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dobierz ponownie" })).toBeHidden();
  });
});
