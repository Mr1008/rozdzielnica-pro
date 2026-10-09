import { createElement } from "react";
import { renderToString } from "react-dom/server.edge";
import { CabinetDrawing } from "@/components/cabinets/CabinetDrawing";
import { buildDrawnCables, buildDrawnDevices, buildDrawnWires } from "@/lib/cabinet-drawing";
import { wireLengthsBySection } from "@/lib/cabinet-wiring";
import { computeMatchView } from "@/lib/device-matching-server";
import { computeLayoutView, computeWiring } from "@/lib/layout-server";
import { realisticFixture, worstCaseFixture, type RenderFixture } from "@/lib/wiring-bench-fixtures";

/**
 * THROWAWAY benchmark Worker (`rozdzielnica-pro-wiring-bench`) for change `realistic-wiring-render`.
 * One request runs the project page's whole render path on a fixed fixture, so the per-invocation CPU
 * time Cloudflare reports for the request is the cost of that path. It uses the real modules, never
 * copies. See `README.md` next to this file for the measurement procedure.
 *
 * It does not time itself: `performance.now()` in a Worker only advances on I/O, so inside a pure
 * computation it would read 0. The response body carries sizes only, so the work cannot be optimised
 * away. Deploy it only with `npx wrangler deploy -c scripts/wiring-bench/wrangler.jsonc`.
 */

const FIXTURES: Record<string, () => RenderFixture> = {
  worst: worstCaseFixture,
  realistic: realisticFixture,
};

function renderPath({ context, placements }: RenderFixture): string {
  const match = computeMatchView(context);
  const layout = computeLayoutView(match, context, placements);
  if (layout?.state !== "placed" || context.geometry === null) {
    throw new Error(`fixture layout is not placed: ${String(layout?.state)}`);
  }
  const devices = buildDrawnDevices(match.snapshot, layout.placements, context.geometry, context.groups);
  const conductors = computeWiring(layout, match, context);
  const wires = buildDrawnWires(conductors, {
    circuits: new Map(context.circuits.map((circuit) => [circuit.id, circuit.name])),
    devices,
  });
  const cables = buildDrawnCables(conductors);
  const lengths = wireLengthsBySection(conductors);
  const svg = renderToString(createElement(CabinetDrawing, { geometry: context.geometry, devices, wires, cables }));
  return `conductors=${String(conductors.length)} wires=${String(wires.length)} cables=${String(cables.length)} lengthRows=${String(lengths.length)} svgBytes=${String(svg.length)}`;
}

export default {
  fetch(request: Request): Response {
    const name = new URL(request.url).searchParams.get("fixture") ?? "";
    // Own properties only: a `?fixture=toString` must not reach `Object.prototype`.
    const fixture = Object.hasOwn(FIXTURES, name) ? FIXTURES[name] : undefined;
    if (fixture === undefined) {
      return new Response("use ?fixture=worst or ?fixture=realistic\n", { status: 400 });
    }
    return new Response(`${name}: ${renderPath(fixture())}\n`);
  },
};
