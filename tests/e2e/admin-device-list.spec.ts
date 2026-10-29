// The admin device catalog at catalog scale (change catalog-pickers): kind sections start closed,
// rows sort by parameters, and the filters run in the browser. Signs in as the admin seeded by
// supabase/seed.sql. The archived-row case inserts one archived copy of a seeded MCB through the
// service client (archived devices never reach the matcher) and deletes it afterwards.
import { test, expect, type Page } from "@playwright/test";

import { createServiceClient, readStackEnv, SEEDED_ADMIN } from "../integration/support";
import { signedInContext } from "./support";

const mcbSection = (page: Page) =>
  page.locator("details").filter({ has: page.locator("summary", { hasText: "Wyłącznik nadprądowy B (MCB)" }) });
/** By the row's exact `data-model`: names repeat across manufacturers, and "B16 1P" is a prefix of "B16 1P+N". */
const deviceRow = (page: Page, model: string) => page.locator(`tr[data-model="${model}"]`);

test("sections start closed, rows sort by In, and search narrows without a reload", async ({ browser, baseURL }) => {
  const context = await signedInContext(browser, baseURL, SEEDED_ADMIN);
  const page = await context.newPage();
  await page.goto("/admin/devices");

  await expect(mcbSection(page)).not.toHaveAttribute("open");
  await mcbSection(page).locator("summary").click();
  const names = await mcbSection(page).getByRole("row").allInnerTexts();
  const b6 = names.findIndex((text) => text.includes("Wyłącznik nadprądowy B6 1P"));
  const b10 = names.findIndex((text) => text.includes("Wyłącznik nadprądowy B10 1P"));
  expect(b6).toBeGreaterThan(-1);
  expect(b6).toBeLessThan(b10);
  await mcbSection(page).locator("summary").click();

  await page.getByLabel("Szukaj").fill("B16 1P");
  await expect(mcbSection(page)).toHaveAttribute("open", "");
  await expect(deviceRow(page, "PRZ-B16-1P")).toBeVisible();
  await expect(deviceRow(page, "PRZ-B10-1P")).toBeHidden();
  await expect(page.locator("details[data-catalog-group='rcd']")).toBeHidden();

  await page.getByRole("button", { name: "Wyczyść filtry" }).click();
  await expect(page.locator("details[data-catalog-group='rcd']")).toBeVisible();
  await context.close();
});

test("archived devices stay hidden until 'Pokaż zarchiwizowane' is ticked", async ({ browser, baseURL }) => {
  const service = createServiceClient(readStackEnv());
  const name = `E2E zarchiwizowany B6 ${String(Date.now())}`;
  const model = `E2E-${String(Date.now())}`;
  const { data: seeded, error: readError } = await service
    .from("devices")
    .select(
      "kind, manufacturer, price_grosze, width_mm, height_mm, depth_mm, poles, rated_current_a, residual_current_ma, rcd_type, breaking_capacity_ka, terminal_groups, n_terminal_side",
    )
    .eq("model", "PRZ-B6-1P")
    .single();
  if (readError) throw readError;
  const { data: inserted, error: insertError } = await service
    .from("devices")
    .insert({ ...seeded, name, model, archived_at: new Date().toISOString() })
    .select("id")
    .single();
  if (insertError) throw insertError;

  const context = await signedInContext(browser, baseURL, SEEDED_ADMIN);
  try {
    const page = await context.newPage();
    await page.goto("/admin/devices");

    await page.getByLabel("Szukaj").fill(name);
    await expect(page.getByText("Nic nie pasuje do filtrów. Zmień je lub wyczyść.")).toBeVisible();
    await expect(deviceRow(page, model)).toBeHidden();

    await page.getByLabel("Pokaż zarchiwizowane").check();
    await expect(mcbSection(page)).toHaveAttribute("open", "");
    await expect(deviceRow(page, model)).toBeVisible();
  } finally {
    await context.close();
    await service.from("devices").delete().eq("id", inserted.id);
  }
});
