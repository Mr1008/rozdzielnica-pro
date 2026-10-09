# Wiring bench

A throwaway Worker, `rozdzielnica-pro-wiring-bench`, that runs the project page's full render path on
a fixed fixture and returns a one-line text body. It exists to measure the CPU the render path costs
on Cloudflare, before and after the realistic-wiring change (`context/changes/realistic-wiring-render`).

The render path is `computeMatchView` → `computeLayoutView` → `computeWiring` → `buildDrawnWires` /
`buildDrawnCables` → `wireLengthsBySection` → React `renderToString(<CabinetDrawing …/>)`. The
fixtures are the ones `src/lib/layout-server.test.ts` uses (`src/lib/wiring-bench-fixtures.ts`):

- `?fixture=worst` — 60 circuits, 20 RCD groups, seed cabinet (c)
- `?fixture=realistic` — 12 circuits, 4 RCD groups, seed cabinet (b)

The Worker has no bindings and no secrets. It does not time itself: inside a Worker `performance.now()`
only advances on I/O, so the figure is Cloudflare's per-invocation CPU time.

**Never deploy it under the name `rozdzielnica-pro`** — that is the production Worker. Deploy only with
the explicit config path below, never with the root `wrangler.jsonc`.

## Check without deploying

```bash
npx wrangler deploy -c scripts/wiring-bench/wrangler.jsonc --dry-run
```

## Measurement procedure

1. Deploy the bench (after confirming with the owner of the Cloudflare account):
   `npx wrangler deploy -c scripts/wiring-bench/wrangler.jsonc`. Note the `workers.dev` URL it prints.
2. Start the tail and keep its output:
   `npx wrangler tail rozdzielnica-pro-wiring-bench --format json > tail.jsonl`.
3. Send 5 warm-up requests, then 30 requests per fixture:
   `node scripts/wiring-bench/measure.mjs send https://rozdzielnica-pro-wiring-bench.<account>.workers.dev`.
   It paces the requests 1 s apart: a burst makes the tail drop events (70 back-to-back requests gave
   11 events on 2026-10-08). A freshly deployed `workers.dev` URL can answer with an error page for the
   first few seconds — wait until a single `curl` returns the one-line body before starting.
4. Stop the tail and take the median and max CPU per fixture from the per-invocation CPU field:
   `node scripts/wiring-bench/measure.mjs stats tail.jsonl` (it skips the first 5 events per fixture).
   The tail prints pretty-printed, multi-line JSON; the CPU field is `cpuTime` (ms, integer).
5. Record the median and max for `worst` and `realistic`, with the date and `npx wrangler --version`,
   in `change.md` under `## Measurements`.

If the tail output has no CPU field, read the invocations' CPU time from a Workers Logs query instead
(observability is enabled on the Worker). If that is unavailable too, stop and ask for the Cloudflare
MCP server.

Run the same procedure after the rendering change (Phase 5) so the two sets of numbers compare
like for like. Delete the Worker afterwards: `npx wrangler delete -c scripts/wiring-bench/wrangler.jsonc`.
