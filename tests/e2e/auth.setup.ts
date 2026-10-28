import { test as setup, expect } from "@playwright/test";

import { provisionElectrician } from "./support";

const authFile = "playwright/.auth/user.json";

/**
 * Electrician A — the default session of every spec. `E2E_USERNAME` / `E2E_PASSWORD` (from `.env`)
 * pick an existing local account; with neither set, a fresh one is provisioned in the local stack,
 * which is how CI runs. One without the other is a mistake, not a fallback.
 */
async function electricianA() {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (username && password) return { email: username, password };
  if (username || password) {
    throw new Error(
      "Set both E2E_USERNAME and E2E_PASSWORD, or neither (see context/foundation/test-stack.md, ## E2E)",
    );
  }
  return provisionElectrician("e2e-a");
}

setup("sign in once and save the session", async ({ page }) => {
  const { email, password } = await electricianA();

  await page.goto("/auth/signin");
  // The sign-in form is a React island: input typed before it hydrates is lost. Retry fill + submit
  // until the submit leaves the sign-in page (signing in twice changes nothing). Clear before
  // filling: re-filling the same value fires no change event in a controlled input.
  await expect(async () => {
    await page.getByLabel("Adres email").fill("");
    await page.getByLabel("Adres email").fill(email);
    await page.getByLabel("Hasło", { exact: true }).fill("");
    await page.getByLabel("Hasło", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Zaloguj się" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), { timeout: 5_000 });
  }).toPass();
  await expect(page.getByRole("button", { name: "Wyloguj się" })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
