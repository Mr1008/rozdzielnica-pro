// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // Source maps for the Worker (uploaded by `upload_source_maps` in wrangler.jsonc). Astro builds the
    // `ssr` environment with its own `build` block, so only the top-level option reaches it; the client
    // environment is pinned to `false` so no `.map` file lands in `dist/client`, which is public assets.
    build: { sourcemap: true },
    environments: {
      client: { build: { sourcemap: false } },
    },
  },
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
