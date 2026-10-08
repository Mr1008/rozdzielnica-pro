/**
 * Helper for the wiring bench (see README.md). Dependency-free.
 *
 *   node scripts/wiring-bench/measure.mjs send <base-url>      warm-up + 30 requests per fixture
 *   node scripts/wiring-bench/measure.mjs stats <tail.jsonl>   median / max CPU from saved tail output
 *
 * `stats` reads `wrangler tail --format json` output and reports the CPU time of each invocation per
 * fixture, taken from the request URL's `fixture` query parameter. The tail prints each event as a
 * pretty-printed, multi-line JSON object, so the file is split into top-level objects, not lines.
 *
 * `send` paces the requests (`PACE_MS` apart): a burst makes the tail drop events — measured on
 * 2026-10-08, 70 back-to-back requests yielded 11 tail events.
 */
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const FIXTURES = ["worst", "realistic"];
const WARMUP = 5;
const MEASURED = 30;
const PACE_MS = 1000;

async function send(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");
  for (const fixture of FIXTURES) {
    for (let i = 0; i < WARMUP + MEASURED; i++) {
      const response = await fetch(`${base}/?fixture=${fixture}`);
      const body = (await response.text()).trim();
      if (!response.ok) throw new Error(`${fixture} request ${String(i)}: HTTP ${String(response.status)} ${body}`);
      if (i === 0) console.log(body);
      await sleep(PACE_MS);
    }
    console.log(`${fixture}: sent ${String(WARMUP)} warm-up + ${String(MEASURED)} measured requests`);
  }
}

/** The CPU time in ms of one tail event, from whichever field this wrangler version exposes. */
function cpuMs(event) {
  for (const key of ["cpuTime", "cpuTimeMs", "cpu_time_ms"]) {
    if (typeof event[key] === "number") return event[key];
  }
  return null;
}

function fixtureOf(event) {
  const url = event.event?.request?.url;
  if (typeof url !== "string") return null;
  const match = /[?&]fixture=([a-z]+)/.exec(url);
  return match ? match[1] : null;
}

/** Every top-level JSON object in the text, in order; a string's braces are skipped. */
function jsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (c === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        try {
          objects.push(JSON.parse(text.slice(start, i + 1)));
        } catch {
          // A truncated object (the tail was stopped mid-event) is skipped.
        }
      }
    }
  }
  return objects;
}

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stats(file) {
  const byFixture = new Map(FIXTURES.map((name) => [name, []]));
  let events = 0;
  let missingCpu = 0;
  for (const event of jsonObjects(readFileSync(file, "utf8"))) {
    const fixture = fixtureOf(event);
    if (fixture === null || !byFixture.has(fixture)) continue;
    events += 1;
    const cpu = cpuMs(event);
    if (cpu === null) missingCpu += 1;
    else byFixture.get(fixture).push(cpu);
  }
  if (events > 0 && missingCpu === events) {
    console.log("The tail output has no CPU field: query Workers Logs for the invocations' CPU time instead.");
    return;
  }
  for (const [name, all] of byFixture) {
    // The first WARMUP invocations per fixture are warm-up; they are the first events in tail order.
    const samples = all.slice(WARMUP).sort((a, b) => a - b);
    if (samples.length === 0) {
      console.log(`${name}: no samples`);
      continue;
    }
    if (all.length < WARMUP + MEASURED) {
      console.log(`${name}: only ${String(all.length)} of ${String(WARMUP + MEASURED)} events — the tail dropped some`);
    }
    console.log(
      `${name}: n=${String(samples.length)} median ${median(samples).toFixed(2)} ms, max ${samples[samples.length - 1].toFixed(2)} ms`,
    );
  }
}

const [command, target] = process.argv.slice(2);
if (command === "send" && target) await send(target);
else if (command === "stats" && target) stats(target);
else {
  console.error("usage: measure.mjs send <base-url> | stats <tail.jsonl>");
  process.exitCode = 1;
}
