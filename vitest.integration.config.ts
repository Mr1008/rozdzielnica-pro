import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integration tests: they talk to the local Supabase stack and create real rows in it.
 *
 * Run them with `npx supabase start` (or `npx supabase db reset`) already done —
 * `tests/integration/*` reads the stack's URL and keys from `supabase status -o env`, never from a
 * committed file.
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
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // Every file here shares one database and creates real users in it, so they must not overlap.
    fileParallelism: false,
    // Sign-up and sign-in go through GoTrue's bcrypt work factor, and the first call also wakes a
    // cold container; the 5s/10s defaults are too tight for that.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
