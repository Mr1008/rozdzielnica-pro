import type { Page } from "@playwright/test";

/**
 * Resolves once every Astro island on the page has hydrated: Astro removes an island's `ssr`
 * attribute when it hydrates. Wait on this before the first input into a React island whose submit
 * is not safe to retry — input typed before hydration is silently lost.
 */
export async function waitForIslands(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
}
