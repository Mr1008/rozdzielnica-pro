import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests: no database, no network, no Supabase stack.
 *
 * Deliberately a separate config from `vitest.integration.config.ts`, because the two suites have
 * incompatible requirements — this one has to be runnable in the fast CI job, which never starts a
 * Supabase container.
 */
export default defineConfig({
  resolve: {
    // Astro 7 exports no `getViteConfig` helper, so the `@/*` alias has to be declared by hand.
    // Keep it in sync with `compilerOptions.paths` in tsconfig.json.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
