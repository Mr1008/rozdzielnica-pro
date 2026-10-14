# Wiring bench

A standalone benchmark Worker, **`rozdzielnica-pro-wiring-bench`**, that measures how much Cloudflare
CPU time the cabinet wiring render costs.

Wiring is routed and drawn in the browser because the router exceeded the Worker CPU budget (see
`AGENTS.md`, "Wiring (S-11) is display-only"). Any proposal to move it back to the server has to be
decided with numbers from this bench on Cloudflare — never from local timings.

> **Never deploy this under the name `rozdzielnica-pro`** — that is the production Worker. Always pass
> `-c scripts/wiring-bench/wrangler.jsonc`; never deploy with the root `wrangler.jsonc`.

## What it measures

Each request runs the full server-side render path on a fixed fixture, using the real modules:

`computeMatchView` → `computeLayoutView` → `routeWiring` → `buildDrawnWires` / `buildDrawnCables` /
`buildCableTies` / `buildDrawnBusbars` → `wireLengthsBySection` → `renderToString(<CabinetDrawing/>)`

The response is a single line of sizes (conductors, wires, SVG bytes…), so the work cannot be optimised
away. The Worker does not time itself — inside a Worker `performance.now()` only advances on I/O — so
the figure is Cloudflare's per-invocation `cpuTime`.

Fixtures come from `src/lib/wiring-bench-fixtures.ts` (shared with `src/lib/layout-server.test.ts`):

| Query                | Project                                                 |
| -------------------- | ------------------------------------------------------- |
| `?fixture=worst`     | 60 circuits, 20 RCD groups, seed cabinet (c)            |
| `?fixture=realistic` | 12 circuits, 4 RCD groups, seed cabinet (b)             |
| `?fixture=busbar`    | The realistic project with a comb busbar in every group |

The Worker has no bindings and no secrets; observability is enabled.

## Files

| File             | Purpose                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `worker.ts`      | The Worker: one fixture per request                                  |
| `wrangler.jsonc` | Its own config, name `rozdzielnica-pro-wiring-bench`                 |
| `measure.mjs`    | Dependency-free helper: `send` requests, compute `stats` from a tail |

## Check the build without deploying

```bash
npx wrangler deploy -c scripts/wiring-bench/wrangler.jsonc --dry-run
```

## Measuring

Deploying creates a Worker on the Cloudflare account — confirm with the account owner first.

1. Deploy and note the `workers.dev` URL:

   ```bash
   npx wrangler deploy -c scripts/wiring-bench/wrangler.jsonc
   ```

   A fresh URL can answer with an error page for a few seconds; wait until a single `curl` returns the
   one-line body.

2. Keep a tail running and save its output:

   ```bash
   npx wrangler tail rozdzielnica-pro-wiring-bench --format json > tail.jsonl
   ```

3. Send 5 warm-up and 30 measured requests per fixture, paced 1 s apart (a burst makes the tail drop
   events):

   ```bash
   node scripts/wiring-bench/measure.mjs send https://rozdzielnica-pro-wiring-bench.<account>.workers.dev
   ```

   `send` covers `worst` and `realistic`. To measure `busbar`, add it to `FIXTURES` in `measure.mjs`.

4. Stop the tail and compute median and max CPU per fixture (warm-ups are skipped):

   ```bash
   node scripts/wiring-bench/measure.mjs stats tail.jsonl
   ```

   If the tail has no CPU field, read `cpuTime` from a Workers Logs query instead.

5. Record median and max per fixture with the date and `npx wrangler --version` in the change's
   `change.md` under `## Measurements`. Measure before and after the change you are evaluating, with the
   same procedure, so the numbers compare like for like.

6. Delete the Worker:

   ```bash
   npx wrangler delete -c scripts/wiring-bench/wrangler.jsonc
   ```

## Previous results

The baseline and the realistic-wiring router were measured on 2026-10-08/09; the tables are in
`context/archive/2026-10-08-realistic-wiring-render/change.md` under `## Measurements`.
