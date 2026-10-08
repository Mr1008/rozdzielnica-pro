#!/usr/bin/env node
/**
 * Mirror `context/foundation/roadmap.md` into GitHub issues, labels, a milestone
 * and a Projects v2 board.
 *
 * roadmap.md stays the contract the /10x-* skills read; GitHub is the tracking and
 * communication surface. Re-running the script syncs GitHub to the file — it never
 * invents work and never deletes anything.
 *
 * `## Parked` entries are mirrored too: each becomes an open issue labelled `odłożone`
 * (no milestone), placed on the board in the `Odłożone` column. An entry that already links its issue
 * ("Śledzone w GitHub [#N](…)") keeps it; any other gets a "Pomysł: …" issue. The script
 * rewrites only the bodies it wrote itself (marked with PARKED_MARKER), never a hand-written one.
 *
 * It works in three steps, so a re-run that has nothing to change makes no write call at all:
 *   1. FETCH   — every issue (with body, labels, milestone, parent, blockers), the labels, milestones
 *                and the board (fields, views, items with their field values) in a handful of GraphQL
 *                requests, run in parallel.
 *   2. DIFF    — the desired state from roadmap.md is compared with the fetched one in memory and
 *                turned into a list of operations. Anything already in the desired state yields none.
 *   3. EXECUTE — only with --apply, only those operations; independent ones run with modest
 *                concurrency (CONCURRENCY), operations that must stay ordered share a "lane".
 *
 *   node scripts/roadmap-to-github.mjs            # fetch + diff, prints the planned operations, writes nothing
 *   node scripts/roadmap-to-github.mjs --apply    # …and execute them on GitHub
 *
 * A status never moves backwards. Several sessions work in parallel worktrees, each with its own
 * copy of roadmap.md, so the local file is often behind. Before the diff, each item's status is
 * lifted to the most advanced one found in: this roadmap, the roadmap of every other git worktree
 * (read from disk, uncommitted edits included), any `context/changes/<change-id>/` folder in any
 * worktree (its change.md status: implementing / implemented / impl_reviewed → "in-progress",
 * anything else → "planning"), and the card's current Status column on the board. Every lift is
 * printed. `blocked` is explicit and never lifted. To really move an item back (say, a slice
 * dropped to "proposed"), run with `--allow-regress`, which trusts this roadmap.md alone.
 *
 * The active `gh` account must have write access to REPO. To use a non-active
 * account for one run:
 *
 *   GH_TOKEN=$(gh auth token --user Mr1008) node scripts/roadmap-to-github.mjs --apply
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const REPO = process.env.ROADMAP_REPO ?? "Mr1008/rozdzielnica-pro";
const [OWNER, REPO_NAME] = REPO.split("/");
const ROADMAP = "context/foundation/roadmap.md";
const APPLY = process.argv.includes("--apply");
const WRITE_BACK = APPLY && !process.argv.includes("--no-write-back");
const ALLOW_REGRESS = process.argv.includes("--allow-regress");
/** How many independent write lanes run at once. Modest on purpose: GitHub throttles bursts of writes. */
const CONCURRENCY = 4;

const tmp = mkdtempSync(join(tmpdir(), "roadmap-gh-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

/* ── gh plumbing ─────────────────────────────────────────────────────────── */

const execFileP = promisify(execFile);

async function gh(args, { allowFail = false } = {}) {
  try {
    const { stdout } = await execFileP("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    if (allowFail) return null;
    const detail = [err.stderr, err.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed:\n${detail || err.message}`, { cause: err });
  }
}

async function ghJson(args, opts) {
  const out = await gh(args, opts);
  return out ? JSON.parse(out) : null;
}

/** Writes `content` to a unique temp file so no shell quoting or encoding can mangle it. */
let tmpSeq = 0;
function tmpFile(ext, content) {
  const path = join(tmp, `f-${++tmpSeq}.${ext}`);
  writeFileSync(path, content, "utf8");
  return path;
}

/**
 * GraphQL with structured variables. `gh api graphql -f` only takes scalars, so the whole body goes
 * through a temp JSON file — that also keeps Polish text intact. A failed READ throws; a `soft`
 * mutation only reports, like every best-effort write in this script.
 */
async function graphql(query, variables, { soft = false } = {}) {
  const out = await gh(["api", "graphql", "--input", tmpFile("json", JSON.stringify({ query, variables }))], {
    allowFail: soft,
  });
  if (!out) return null;
  const parsed = JSON.parse(out);
  if (parsed.errors) {
    const msg = parsed.errors.map((e) => e.message).join("; ");
    if (!soft) throw new Error(`GraphQL: ${msg}`);
    console.log(`     ! GraphQL: ${msg}`);
  }
  return parsed;
}

/** REST call with a JSON payload (issue fields, labels and the like); the response is parsed JSON. */
const rest = (method, path, payload, opts) =>
  ghJson(
    [
      "api",
      path,
      "-X",
      method,
      ...(payload === undefined ? [] : ["--input", tmpFile("json", JSON.stringify(payload))]),
    ],
    opts,
  );

/** Colours for the built-in Status options, so the board reads at a glance. */
const STATUS_COLOR = {
  Zablokowane: "RED",
  Propozycja: "GRAY",
  "Gotowe do planowania": "GREEN",
  "W planowaniu": "BLUE",
  "W realizacji": "YELLOW",
  Zrobione: "PURPLE",
  Odłożone: "PINK",
};

/* ── roadmap.md parsing ──────────────────────────────────────────────────── */

const md = readFileSync(ROADMAP, "utf8");

function frontmatter(key) {
  const m = md.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^"|"$/g, "") : null;
}

function field(block, key) {
  const m = block.match(new RegExp(`\\*\\*${key}:\\*\\*\\s*(.*)`));
  return m ? m[1].trim() : "";
}

/** Multi-line field: the `- **Unknowns:**` bullet plus its indented children. */
function listField(block, key) {
  const m = block.match(new RegExp(`\\*\\*${key}:\\*\\*([\\s\\S]*?)(?=\\n- \\*\\*|$)`));
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^\s*-\s*/, "").trim())
    .filter((l) => l && l !== "—");
}

const milestone = (() => {
  const m = md.match(/^\*\*(M-\d+): (.+?)\*\* — Status: (\w+)/m);
  const block = md.match(/## Milestone\n([\s\S]*?)\n## /);
  return {
    tag: m[1],
    name: m[2],
    status: m[3],
    id: frontmatter("milestone_id"),
    intent: field(block[1], "Intent"),
    doneWhen: field(block[1], "Done when"),
    sources: field(block[1], "Source materials"),
    anchors: field(block[1], "Scope anchors"),
  };
})();

const northStar = md.match(/## North star\n\n\*\*([FS]-\d\d):/)?.[1] ?? null;

const streams = [...md.matchAll(/^\| ([A-Z]) +\| ([^|]+?) +\| ([^|]+?) +\| ([^|]*?) +\|$/gm)]
  .filter((r) => /`[FS]-\d\d`/.test(r[3]))
  .map((r) => ({ key: r[1], theme: r[2].trim(), ids: r[3].match(/[FS]-\d\d/g) ?? [] }));

const items = [...md.matchAll(/^### ([FS]-\d\d): (.+?)\n([\s\S]*?)(?=\n### |\n## )/gm)].map((m) => {
  const [id, title, block] = [m[1], m[2].trim(), m[3]];
  const stream = streams.find((s) => s.ids.includes(id));
  const outcome = field(block, "Outcome")
    .replace(/^\(foundation\)\s*/, "")
    .replace(/^./, (c) => c.toUpperCase());
  return {
    id,
    title,
    outcome,
    isFoundation: id.startsWith("F"),
    changeId: field(block, "Change ID").replace(/`/g, ""),
    prdRefs: field(block, "PRD refs"),
    unlocks: field(block, "Unlocks"),
    prerequisites: field(block, "Prerequisites").match(/[FS]-\d\d/g) ?? [],
    prerequisitesRaw: field(block, "Prerequisites"),
    parallel: field(block, "Parallel with"),
    blockers: field(block, "Blockers"),
    unknowns: listField(block, "Unknowns").filter((u) => !u.startsWith("**Unknowns")),
    risk: field(block, "Risk"),
    status: field(block, "Status"),
    stream: stream ? `${stream.key} · ${stream.theme}` : null,
    isNorthStar: id === northStar,
  };
});

for (const it of items) {
  it.unblocks = items.filter((o) => o.prerequisites.includes(it.id)).map((o) => o.id);
}

if (items.length === 0) throw new Error(`No F-NN/S-NN items parsed from ${ROADMAP}`);

/* ── status lifting: other worktrees, change folders, the board ───────────── */

/** The forward order of statuses. `blocked` is not on it: it is explicit, never lifted or used to lift. */
const STATUS_RANK = { proposed: 0, ready: 1, planning: 2, "in-progress": 3, done: 4 };
const IMPLEMENTING = new Set(["implementing", "implemented", "impl_reviewed"]);

/** Every git worktree of this repository, this one included. Empty when git is unavailable. */
function worktreePaths() {
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" });
    return out
      .split(/\r?\n/)
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length).trim())
      .filter((path) => existsSync(path));
  } catch {
    return [];
  }
}

/**
 * Each candidate status per item id, with where it came from. The local roadmap is the item's own
 * `status`; this adds the other worktrees' roadmaps and the change folders of all of them.
 */
function worktreeHints() {
  const here = resolve(".").toLowerCase();
  const hints = new Map(items.map((it) => [it.id, []]));
  for (const path of worktreePaths()) {
    const other = resolve(path).toLowerCase() !== here;
    const name = other ? `worktree ${path}` : "ten worktree";
    if (other) {
      const file = join(path, ROADMAP);
      if (existsSync(file)) {
        const text = readFileSync(file, "utf8");
        for (const m of text.replace(/\r\n/g, "\n").matchAll(/^### ([FS]-\d\d): .+?\n([\s\S]*?)(?=\n### |\n## )/gm)) {
          hints.get(m[1])?.push({ status: field(m[2], "Status"), from: `roadmap w ${name}` });
        }
      }
    }
    for (const it of items) {
      const change = join(path, "context", "changes", it.changeId, "change.md");
      if (!it.changeId || !existsSync(change)) continue;
      const status = readFileSync(change, "utf8").match(/^status:\s*(\S+)/m)?.[1] ?? "";
      if (status === "archived") continue;
      hints.get(it.id).push({
        status: IMPLEMENTING.has(status) ? "in-progress" : "planning",
        from: `context/changes/${it.changeId} (${status || "bez statusu"}) w ${name}`,
      });
    }
  }
  return hints;
}

const hints = ALLOW_REGRESS ? new Map() : worktreeHints();

/**
 * `## Parked` entries: `- **Title** — Why parked: reason`, continued on indented lines. `issue` is
 * the number of a GitHub issue the entry already links, or null.
 */
const parked = (() => {
  const section = md.match(/\n## Parked\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
  const entries = [];
  for (const line of section.split("\n")) {
    if (line.startsWith("- **")) entries.push(line.slice(2));
    else if (/^\s+\S/.test(line) && entries.length > 0) entries[entries.length - 1] += ` ${line.trim()}`;
  }
  return entries.map((text) => {
    const title = text.match(/^\*\*(.+?)\*\*/)[1].trim();
    const rest = text.slice(text.indexOf("**", 2) + 2).trim();
    const issue = text.match(new RegExp(`github\\.com/${REPO}/issues/(\\d+)`))?.[1];
    return { title, rest: rest.replace(/^\s*—\s*/, ""), issue: issue ? Number(issue) : null };
  });
})();

/* ── presentation: labels + issue bodies (Polish, readable without dev context) ─ */

const STATUS_PL = {
  proposed: "Propozycja",
  ready: "Gotowe do planowania",
  blocked: "Zablokowane",
  planning: "W planowaniu",
  "in-progress": "W realizacji",
  done: "Zrobione",
};

/**
 * Stream themes read well in a table ("Projekt → dobór → układ") but make terrible
 * label names, so they get a short alias; unknown streams fall back to a sanitised theme.
 */
const STREAM_ALIASES = { A: "katalogi i role", B: "projekt i układ", C: "wycena" };
const streamName = (s) =>
  STREAM_ALIASES[s.key] ??
  s.theme
    .toLowerCase()
    .replace(/\s*[→·/]\s*/g, " i ")
    .replace(/\s+/g, " ")
    .trim();
const streamLabel = (it) => {
  const s = streams.find((x) => it.stream?.startsWith(`${x.key} · `));
  return s ? `strumień: ${streamName(s)}` : null;
};

const LABELS = [
  {
    name: "typ: fundament",
    color: "5319E7",
    description: "Praca techniczna bez widocznej funkcji — istnieje po to, żeby odblokować inne zadania",
  },
  { name: "typ: funkcja", color: "0E8A16", description: "Zadanie kończące się funkcją, którą widzi użytkownik" },
  ...streams.map((s, i) => ({
    name: `strumień: ${streamName(s)}`,
    color: ["1D76DB", "0052CC", "006B75", "5319E7"][i % 4],
    description: `Tor prac ${s.key}: ${s.theme}`,
  })),
  { name: "rola: admin", color: "FBCA04", description: "Dotyczy administratora prowadzącego katalogi" },
  { name: "rola: elektryk", color: "D4C5F9", description: "Dotyczy elektryka planującego rozdzielnicę" },
  {
    name: "gwiazda przewodnia",
    color: "E99695",
    description: "Zadanie, które udowadnia sens produktu — dlatego idzie tak wcześnie, jak się da",
  },
  {
    name: "zablokowane: decyzja",
    color: "B60205",
    description: "Czeka na rozstrzygnięcie otwartego pytania, nie na kod",
  },
  { name: "gotowe do planowania", color: "C2E0C6", description: "Wszystkie zależności spełnione — można zaczynać" },
  { name: "kamień milowy", color: "1D76DB", description: "Zbiorcze zadanie z całym planem kamienia milowego" },
  {
    name: "odłożone",
    color: "BFD4F2",
    description: "Pomysł odłożony w roadmapie (## Parked) — poza bieżącym kamieniem milowym",
  },
];

function labelsFor(it) {
  const out = [it.isFoundation ? "typ: fundament" : "typ: funkcja"];
  const sl = streamLabel(it);
  if (sl) out.push(sl);
  // The actor is the SUBJECT of the outcome sentence, not any mention of a role:
  // "…błąd z prośbą o kontakt z administratorem" is still an elektryk task.
  const actor = /^(Admin|Elektryk)\b/.exec(it.outcome)?.[1] ?? /^(Admin|Elektryk)\b/.exec(it.title)?.[1];
  if (it.isFoundation || actor === "Admin") out.push("rola: admin");
  if (it.isFoundation || actor === "Elektryk") out.push("rola: elektryk");
  if (it.isNorthStar) out.push("gwiazda przewodnia");
  if (it.status === "blocked") out.push("zablokowane: decyzja");
  if (it.status === "ready") out.push("gotowe do planowania");
  return [...new Set(out)];
}

const issueTitle = (it) => `${it.id} · ${it.title}`;

/** roadmap.md keeps schema jargon (Owner / Block: yes); issues are read by non-devs. */
const plainPl = (s) =>
  s
    .replace(/Owner:\s*user\b/gi, "kto rozstrzyga: Ty")
    .replace(/Owner:\s*/gi, "kto rozstrzyga: ")
    .replace(/Block:\s*yes/gi, "**blokuje start prac: tak**")
    .replace(/Block:\s*no/gi, "blokuje start prac: nie");

const fileLink = (path, text) => `[\`${text ?? path}\`](https://github.com/${REPO}/blob/master/${path})`;

function issueBody(it, numbers) {
  const ref = (id) => (numbers[id] ? `#${numbers[id]} (${id})` : id);
  const L = [];
  L.push(`**Co to daje:** ${it.outcome}`);
  L.push("");
  L.push("| | |");
  L.push("| --- | --- |");
  L.push(`| Pozycja w roadmapie | \`${it.id}\`${it.stream ? ` · strumień ${it.stream}` : ""} |`);
  L.push(
    `| Rodzaj | ${it.isFoundation ? "Fundament — praca techniczna, bez widocznej funkcji" : "Funkcja widoczna dla użytkownika"} |`,
  );
  L.push(`| Stan w roadmapie | ${STATUS_PL[it.status] ?? it.status} |`);
  L.push(`| Change ID | \`${it.changeId}\` |`);
  if (it.isNorthStar) L.push(`| Uwaga | To **gwiazda przewodnia** kamienia milowego |`);
  L.push("");

  L.push("## Zależności");
  L.push(
    `- **Zależy od:** ${it.prerequisites.length ? it.prerequisites.map(ref).join(", ") : "nic — można zacząć od razu"}`,
  );
  L.push(`- **Odblokowuje:** ${it.unblocks.length ? it.unblocks.map(ref).join(", ") : "—"}`);
  if (it.unlocks) L.push(`- **Po co ten fundament:** ${it.unlocks}`);
  if (it.parallel && it.parallel !== "—") L.push(`- **Może iść równolegle z:** ${it.parallel}`);
  L.push("");
  L.push(
    "> Te same zależności są ustawione natywnie w GitHubie (sekcja *Blocked by* nad opisem), więc widać je też na tablicy i w liście zadań.",
  );
  L.push("");

  if (it.unknowns.length) {
    L.push("## Otwarte pytania");
    for (const u of it.unknowns) L.push(`- ${plainPl(u)}`);
    L.push("");
  }
  if (it.blockers && it.blockers !== "—") {
    L.push("## Blokady zewnętrzne");
    L.push(it.blockers);
    L.push("");
  }

  L.push("## Na co uważać");
  L.push(it.risk);
  L.push("");

  L.push("## Skąd to wymaganie");
  L.push(`- PRD: ${it.prdRefs} — ${fileLink("context/foundation/prd.md")}`);
  L.push(`- Roadmapa: pozycja \`${it.id}\` w ${fileLink(ROADMAP)}`);
  L.push("");
  L.push(
    `<sub>Wygenerowane z \`${ROADMAP}\` przez \`scripts/roadmap-to-github.mjs\`. Zmiany zakresu rób w roadmapie i uruchom skrypt ponownie — postęp śledzimy tutaj.</sub>`,
  );
  return L.join("\n");
}

function parentBody(numbers) {
  const L = [];
  L.push(`**${milestone.intent}**`);
  L.push("");
  L.push(`Kamień milowy jest zamknięty wynikiem, nie datą. **Gotowe, gdy:** ${milestone.doneWhen}`);
  L.push("");
  L.push("## Plan w jednej tabeli");
  L.push("");
  L.push("| # | Zadanie | Co to daje | Zależy od | Stan |");
  L.push("| --- | --- | --- | --- | --- |");
  for (const it of items) {
    const deps = it.prerequisites.map((d) => (numbers[d] ? `#${numbers[d]}` : d)).join(", ") || "—";
    const n = numbers[it.id] ? `#${numbers[it.id]}` : it.id;
    L.push(
      `| ${it.id} | ${n} | ${it.outcome} | ${deps} | ${STATUS_PL[it.status] ?? it.status}${it.isNorthStar ? " ⭐" : ""} |`,
    );
  }
  L.push("");
  L.push(
    "⭐ = gwiazda przewodnia: zadanie, którego powodzenie dowodzi, że produkt ma sens. Stoi tak wcześnie, jak pozwalają zależności.",
  );
  L.push("");
  L.push("## Tory prac");
  for (const s of streams)
    L.push(`- **${s.key} · ${s.theme}:** ${s.ids.map((i) => (numbers[i] ? `#${numbers[i]}` : i)).join(" → ")}`);
  L.push("");
  L.push("## Jak to czytać");
  L.push(
    "- **Fundament** (fioletowa etykieta) — praca techniczna, której użytkownik nie zobaczy; istnieje po to, żeby odblokować zadania poniżej.",
  );
  L.push(
    "- **Funkcja** (zielona etykieta) — kończy się czymś, co elektryk albo admin realnie może zrobić w aplikacji.",
  );
  L.push("- **Zablokowane: decyzja** (czerwona) — nie czeka na kod, tylko na rozstrzygnięcie pytania.");
  L.push("- Kolejność wynika z zależności, nie z kalendarza — w roadmapie celowo nie ma dat ani szacunków.");
  L.push("");
  L.push(`## Źródła`);
  L.push(`- Zakres: ${milestone.anchors}`);
  L.push(`- Materiał źródłowy: ${milestone.sources}`);
  L.push(`- Kontrakt dla narzędzi: ${fileLink(ROADMAP)}`);
  L.push("");
  L.push(`<sub>Wygenerowane z \`${ROADMAP}\` przez \`scripts/roadmap-to-github.mjs\`.</sub>`);
  return L.join("\n");
}

function projectReadme(numbers, parent) {
  const L = [];
  L.push(`## ${milestone.tag}: ${milestone.name}`);
  L.push("");
  L.push(milestone.intent);
  L.push("");
  L.push(
    `**Pełny plan w jednym miejscu:** ${REPO.split("/")[1]} → [issue #${parent}](https://github.com/${REPO}/issues/${parent})`,
  );
  L.push("");
  L.push("### Jak czytać tablicę");
  L.push(
    "- **Status** — kolumny na tablicy: `Zablokowane` → `Propozycja` → `Gotowe do planowania` → `W planowaniu` → `W realizacji` → `Zrobione`.",
  );
  L.push("- **Strumień** — trzy równoległe tory prac; zadania z różnych torów mogą iść jednocześnie.");
  L.push(
    "- **Rodzaj** — `Fundament` to praca techniczna bez widocznej funkcji, `Funkcja` kończy się czymś, co widać w aplikacji.",
  );
  L.push("- Kolejność wynika z zależności między zadaniami, nie z kalendarza. Celowo nie ma tu dat ani szacunków.");
  L.push("");
  L.push(`Źródło prawdy o zakresie: \`${ROADMAP}\` w repozytorium. Tablica jest generowana z tego pliku.`);
  return L.join("\n");
}

/* ── parked ideas ─────────────────────────────────────────────────────────── */

/** Marks a body this script wrote, so a hand-written parked issue is never overwritten. */
const PARKED_MARKER = "<!-- roadmap-to-github: parked -->";

const parkedTitle = (p) => `Pomysł: ${p.title}`;

function parkedBody(p) {
  const L = [PARKED_MARKER, "## Pomysł", "", plainPl(p.title), ""];
  // The entry's own "Śledzone w GitHub [#N](…)" points at this very issue, so it is dropped.
  const reason = p.rest.replace(/^Why parked:\s*/, "").replace(/\s*Śledzone w\s+GitHub\s+\[#\d+\]\([^)]*\)\.?/, "");
  L.push("## Dlaczego odłożone", "", plainPl(reason), "");
  L.push(`Odłożone w ${fileLink(ROADMAP)} → \`## Parked\`. Ten opis jest generowany z roadmapy — zmieniaj tam.`);
  return L.join("\n");
}

/** Appends "Śledzone w GitHub [#N](…)" to each parked entry that does not link its issue yet. */
function writeBackParked(text, numbers) {
  let out = text;
  for (const [p, n] of numbers) {
    if (p.issue) continue;
    const head = `- **${p.title}**`;
    const start = out.indexOf(head);
    if (start === -1) continue;
    // The entry ends where the next line no longer continues it (a new bullet, a blank line, a heading).
    const tail = out.slice(start).search(/\n(?! {2}\S)/);
    const end = tail === -1 ? out.length : start + tail;
    const link = ` Śledzone w GitHub [#${n}](https://github.com/${REPO}/issues/${n}).`;
    out = out.slice(0, end) + link + out.slice(end);
  }
  return out;
}

/** Adds `- **Issue:** #N` to each roadmap item so the link is bidirectional. */
function writeBack(numbers, parkedNumbers) {
  console.log("\nLinkowanie zwrotne w roadmap.md");
  let out = writeBackParked(md, parkedNumbers);
  for (const it of items) {
    const n = numbers[it.id];
    if (!n) continue;
    const re = new RegExp(
      `(### ${it.id}:[\\s\\S]*?- \\*\\*Change ID:\\*\\* \`${it.changeId}\`)(\\n- \\*\\*Issue:\\*\\* #\\d+)?`,
    );
    out = out.replace(re, `$1\n- **Issue:** #${n}`);
  }
  if (out === md) {
    console.log("  — brak zmian");
    return;
  }
  writeFileSync(ROADMAP, out, "utf8");
  console.log(`  ✓ dopisano numery issues do ${ROADMAP}`);
}

/* ── step 1: fetch everything ────────────────────────────────────────────── */

const norm = (s) => (s ?? "").replace(/\r\n/g, "\n").trim();

const REPO_QUERY = `
  query ($owner: String!, $name: String!) {
    viewer { login }
    repository(owner: $owner, name: $name) {
      viewerPermission
      labels(first: 100) { pageInfo { hasNextPage } nodes { name color description } }
      milestones(first: 100, states: [OPEN, CLOSED]) { pageInfo { hasNextPage } nodes { number title } }
      projectsV2(first: 50) { nodes { number } }
    }
    repositoryOwner(login: $owner) {
      ... on ProjectV2Owner { projectsV2(first: 100) { pageInfo { hasNextPage } nodes { id number title } } }
    }
  }
`;

const ISSUES_QUERY = `
  query ($owner: String!, $name: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      issues(first: 100, after: $after, states: [OPEN, CLOSED]) {
        pageInfo { hasNextPage endCursor }
        nodes {
          databaseId number title body state
          labels(first: 50) { nodes { name } }
          milestone { title }
          parent { number }
          blockedBy(first: 50) { nodes { number } }
        }
      }
    }
  }
`;

const PROJECT_QUERY = `
  query ($id: ID!) {
    node(id: $id) {
      ... on ProjectV2 {
        id number title readme shortDescription
        fields(first: 50) {
          nodes { ... on ProjectV2FieldCommon { id name } ... on ProjectV2SingleSelectField { options { id name } } }
        }
        views(first: 30) { nodes { id name } }
      }
    }
  }
`;

const PROJECT_ITEMS_QUERY = `
  query ($id: ID!, $after: String) {
    node(id: $id) {
      ... on ProjectV2 {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            content { ... on Issue { number } }
            fieldValues(first: 30) {
              nodes {
                ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              }
            }
          }
        }
      }
    }
  }
`;

function assertComplete(connection, what) {
  if (connection?.pageInfo?.hasNextPage)
    throw new Error(`Za dużo elementów: ${what} (ponad 100) — rozszerz paginację w skrypcie`);
}

async function fetchIssues() {
  const out = [];
  let after = null;
  for (;;) {
    const { data } = await graphql(ISSUES_QUERY, { owner: OWNER, name: REPO_NAME, after });
    const conn = data.repository.issues;
    for (const n of conn.nodes) {
      out.push({
        dbId: n.databaseId,
        number: n.number,
        title: n.title,
        body: n.body ?? "",
        state: n.state,
        labels: n.labels.nodes.map((l) => l.name),
        milestone: n.milestone?.title ?? null,
        parent: n.parent?.number ?? null,
        blockedBy: n.blockedBy.nodes.map((b) => b.number),
      });
    }
    if (!conn.pageInfo.hasNextPage) return out;
    after = conn.pageInfo.endCursor;
  }
}

async function fetchProjectItems(id) {
  const out = [];
  let after = null;
  for (;;) {
    const { data } = await graphql(PROJECT_ITEMS_QUERY, { id, after });
    const conn = data.node.items;
    for (const n of conn.nodes) {
      const values = {};
      for (const v of n.fieldValues.nodes) {
        const name = v.field?.name;
        if (name) values[name] = v.text ?? v.name ?? null;
      }
      out.push({ id: n.id, issue: n.content?.number ?? null, values });
    }
    if (!conn.pageInfo.hasNextPage) return out;
    after = conn.pageInfo.endCursor;
  }
}

/** The board's fields, views, readme and every item with its field values — two requests in parallel. */
async function fetchProject(id) {
  const [meta, itemList] = await Promise.all([graphql(PROJECT_QUERY, { id }), fetchProjectItems(id)]);
  const node = meta.data.node;
  return {
    id: node.id,
    number: node.number,
    title: node.title,
    readme: node.readme ?? "",
    fields: node.fields.nodes.filter((f) => f.id),
    views: node.views.nodes,
    items: itemList,
  };
}

/** Everything the diff needs, in `1 + 1 + 1` round trips (repo+projects, issues, board) run in parallel. */
async function fetchState() {
  const projectTitle = `RozdzielnicaPro — ${milestone.tag}: ${milestone.name}`;
  const [repoData, issues] = await Promise.all([graphql(REPO_QUERY, { owner: OWNER, name: REPO_NAME }), fetchIssues()]);
  const repo = repoData.data.repository;
  if (!repo) throw new Error(`Nie znaleziono repozytorium ${REPO}`);
  assertComplete(repo.labels, "etykiety");
  assertComplete(repo.milestones, "milestone'y");
  const projects = repoData.data.repositoryOwner?.projectsV2;
  assertComplete(projects, "projekty");
  const ref = (projects?.nodes ?? []).find((p) => p.title === projectTitle) ?? null;
  return {
    viewer: repoData.data.viewer.login,
    permission: repo.viewerPermission,
    labels: new Map(repo.labels.nodes.map((l) => [l.name.toLowerCase(), l])),
    milestones: repo.milestones.nodes,
    milestone: null,
    issues,
    linkedProjects: repo.projectsV2.nodes.map((n) => n.number),
    projectTitle,
    projectRef: ref,
    project: ref ? await fetchProject(ref.id) : null,
    itemIssue: new Map(),
    parentIssue: null,
    parkedIssue: new Map(),
  };
}

/* ── step 2: diff — desired state vs fetched state → operations ───────────── */

const SECTIONS = [
  "Etykiety",
  "Milestone",
  "Issues",
  "Relacje (sub-issues + blocked by)",
  "Odłożone pomysły (## Parked)",
  "Project",
];
const S_LABELS = SECTIONS[0];
const S_MILESTONE = SECTIONS[1];
const S_ISSUES = SECTIONS[2];
const S_RELATIONS = SECTIONS[3];
const S_PARKED = SECTIONS[4];
const S_PROJECT = SECTIONS[5];

const BOARD_ORDER = [
  "Zablokowane",
  "Propozycja",
  "Gotowe do planowania",
  "W planowaniu",
  "W realizacji",
  "Zrobione",
  "Odłożone",
];

/** An operation. `lane` serialises ops that must stay ordered; `phase` orders groups of lanes. */
const mk = (label, run, opts = {}) => ({ label, run, ...opts });

class Plan {
  sections = new Map(SECTIONS.map((name) => [name, { ok: 0, changed: 0, ops: [] }]));

  /**
   * One entity (a label, an issue, a board card…): no ops means it is already as desired. `counted`
   * is for an entity an earlier stage already counted (a stand-in for an issue about to be created).
   */
  check(section, ops, { counted = false } = {}) {
    const s = this.sections.get(section);
    if (counted) s.ops.push(...ops);
    else if (ops.length === 0) s.ok += 1;
    else {
      s.changed += 1;
      s.ops.push(...ops);
    }
  }

  get ops() {
    return [...this.sections.values()].flatMap((s) => s.ops);
  }
  get ok() {
    return [...this.sections.values()].reduce((sum, s) => sum + s.ok, 0);
  }
  get changed() {
    return [...this.sections.values()].reduce((sum, s) => sum + s.changed, 0);
  }
}

/** Filled by `fetchState()` in main; the planners read it, a create op writes the issue it made into it. */
let state;

const issueNumber = (issue) => issue?.number ?? null;
const pseudoIssue = (title, extra) => ({
  dbId: null,
  number: null,
  title,
  body: "(tworzenie...)",
  state: "OPEN",
  labels: [],
  milestone: null,
  parent: null,
  blockedBy: [],
  ...extra,
});

/** A just-created issue, from the REST response. */
function fromRest(r, milestoneTitle) {
  return {
    dbId: r.id,
    number: r.number,
    title: r.title,
    body: r.body ?? "",
    state: "OPEN",
    labels: (r.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)),
    milestone: milestoneTitle,
    parent: null,
    blockedBy: [],
  };
}

function numbersMap() {
  return Object.fromEntries(items.map((it) => [it.id, issueNumber(state.itemIssue.get(it.id))]));
}

/**
 * Creates an issue after labels and milestone exist (phase 1), on one lane so the numbers follow
 * roadmap order. `simulate` registers a stand-in (number null) so a dry run can plan the later stages.
 */
function createIssueOp(label, title, { body, labels = [], withMilestone = false }, onCreated) {
  return mk(
    label,
    async () => {
      const created = await rest("POST", `repos/${REPO}/issues`, {
        title,
        body,
        ...(labels.length > 0 ? { labels } : {}),
        ...(withMilestone ? { milestone: state.milestone.number } : {}),
      });
      const issue = fromRest(created, withMilestone ? state.milestone.title : null);
      state.issues.push(issue);
      onCreated(issue);
    },
    {
      phase: 1,
      lane: "create",
      simulate: () => {
        const issue = pseudoIssue(title, { body, labels, milestone: withMilestone ? state.milestone.title : null });
        state.issues.push(issue);
        onCreated(issue);
      },
    },
  );
}

/** Stage A: labels, milestone and the issues that do not exist yet. */
function planBase(plan) {
  for (const l of LABELS) {
    const cur = state.labels.get(l.name.toLowerCase());
    if (!cur) {
      plan.check(S_LABELS, [
        mk(`label "${l.name}"`, () =>
          rest("POST", `repos/${REPO}/labels`, { name: l.name, color: l.color, description: l.description }),
        ),
      ]);
    } else if (cur.color.toLowerCase() !== l.color.toLowerCase() || (cur.description ?? "") !== l.description) {
      plan.check(S_LABELS, [
        mk(`label "${l.name}" (aktualizacja)`, () =>
          rest("PATCH", `repos/${REPO}/labels/${encodeURIComponent(cur.name)}`, {
            color: l.color,
            description: l.description,
          }),
        ),
      ]);
    } else plan.check(S_LABELS, []);
  }

  const msTitle = `${milestone.tag}: ${milestone.name}`;
  const ms = state.milestones.find((m) => m.title === msTitle);
  if (ms) {
    state.milestone = ms;
    plan.check(S_MILESTONE, []);
  } else {
    plan.check(S_MILESTONE, [
      mk(
        `milestone "${msTitle}"`,
        async () => {
          const r = await rest("POST", `repos/${REPO}/milestones`, {
            title: msTitle,
            description: `${milestone.intent} | Gotowe, gdy: ${milestone.doneWhen}`,
          });
          state.milestone = { number: r.number, title: msTitle };
        },
        {
          simulate: () => {
            state.milestone = { number: null, title: msTitle };
          },
        },
      ),
    ]);
  }

  for (const it of items) {
    const title = issueTitle(it);
    const hit = state.issues.find((i) => i.title === title);
    if (hit) {
      state.itemIssue.set(it.id, hit);
    } else {
      plan.check(S_ISSUES, [
        createIssueOp(
          `issue "${title}"`,
          title,
          { body: "(tworzenie...)", labels: labelsFor(it), withMilestone: true },
          (issue) => state.itemIssue.set(it.id, issue),
        ),
      ]);
    }
  }

  const parentTitle = `${milestone.tag} · ${milestone.name}`;
  const parentHit = state.issues.find((i) => i.title === parentTitle);
  if (parentHit) {
    state.parentIssue = parentHit;
  } else {
    plan.check(S_ISSUES, [
      createIssueOp(
        `issue-parasol "${parentTitle}"`,
        parentTitle,
        { body: "(tworzenie...)", withMilestone: true },
        (issue) => {
          state.parentIssue = issue;
        },
      ),
    ]);
  }

  for (const p of parked) {
    const hit = p.issue
      ? state.issues.find((i) => i.number === p.issue)
      : state.issues.find((i) => i.title === parkedTitle(p));
    if (hit) {
      state.parkedIssue.set(p, hit);
    } else if (p.issue) {
      console.log(`  ! "${p.title}": roadmapa linkuje #${p.issue}, ale takiego issue nie ma w ${REPO} — pominięto`);
    } else {
      plan.check(S_PARKED, [
        createIssueOp(
          `issue "${parkedTitle(p)}"`,
          parkedTitle(p),
          { body: parkedBody(p), labels: ["odłożone"] },
          (issue) => state.parkedIssue.set(p, issue),
        ),
      ]);
    }
  }
}

/**
 * One PATCH for everything that differs on an issue — body, labels, open/closed, a missing
 * milestone — or null when nothing does. Labels are reconciled only within `managed`, so a label a
 * human added is never removed.
 */
function patchOp(name, cur, want) {
  const payload = {};
  const parts = [];
  if (want.body !== undefined && norm(want.body) !== norm(cur.body)) {
    payload.body = want.body;
    parts.push("opis");
  }
  if (want.labels) {
    const add = want.labels.filter((l) => !cur.labels.includes(l));
    const remove = cur.labels.filter((l) => want.managed.has(l) && !want.labels.includes(l));
    if (add.length > 0 || remove.length > 0) {
      payload.labels = [...cur.labels.filter((l) => !remove.includes(l)), ...add];
      parts.push(`etykiety${add.map((l) => ` +${l}`).join("")}${remove.map((l) => ` −${l}`).join("")}`);
    }
  }
  if (want.closed !== undefined && (cur.state === "CLOSED") !== want.closed) {
    payload.state = want.closed ? "closed" : "open";
    if (want.closed) payload.state_reason = "completed";
    parts.push(want.closed ? "zamknięcie" : "otwarcie");
  }
  // Only a MISSING milestone is filled in; one a human moved the issue to is left alone.
  if (want.milestone && cur.milestone === null) {
    payload.milestone = state.milestone?.number ?? null;
    parts.push("milestone");
  }
  if (parts.length === 0) return null;
  return mk(`${name}: ${parts.join(", ")}`, () => rest("PATCH", `repos/${REPO}/issues/${cur.number}`, payload), {
    lane: `issue-${cur.number ?? name}`,
  });
}

/** Stage B: bodies, labels, state, relations and parked issues — everything that needs real numbers. */
function planIssues(plan) {
  const numbers = numbersMap();
  const managed = new Set(LABELS.map((l) => l.name));
  const parent = state.parentIssue;

  // Labels this script owns are reconciled in both directions, so a status flip in roadmap.md
  // (blocked → ready, say) removes the stale label instead of stacking; open/closed likewise — a
  // `done` item closes its issue, anything else reopens it.
  for (const it of items) {
    const op = patchOp(`issue ${it.id}`, state.itemIssue.get(it.id), {
      body: issueBody(it, numbers),
      labels: labelsFor(it),
      managed,
      closed: it.status === "done",
      milestone: true,
    });
    plan.check(S_ISSUES, op ? [op] : [], { counted: state.itemIssue.get(it.id).number === null });
  }
  const parentOp = patchOp("issue-parasol", parent, {
    body: parentBody(numbers),
    labels: ["kamień milowy"],
    managed: new Set(),
    milestone: true,
  });
  plan.check(S_ISSUES, parentOp ? [parentOp] : [], { counted: parent.number === null });

  // Native GitHub relations, mirrored from `Prerequisites`.
  const parentRef = parent.number === null ? milestone.tag : `#${parent.number}`;
  for (const it of items) {
    const cur = state.itemIssue.get(it.id);
    const ops = [];
    if (parent.number === null || cur.parent !== parent.number) {
      ops.push(
        mk(
          `${it.id} → pod-zadanie ${parentRef}`,
          () =>
            rest(
              "POST",
              `repos/${REPO}/issues/${parent.number}/sub_issues`,
              { sub_issue_id: cur.dbId },
              { allowFail: true },
            ),
          { lane: "sub", soft: true },
        ),
      );
    }
    for (const dep of it.prerequisites) {
      const depIssue = state.itemIssue.get(dep);
      if (depIssue.number !== null && cur.blockedBy.includes(depIssue.number)) continue;
      ops.push(
        mk(
          `${it.id} blocked by ${dep}`,
          () =>
            rest(
              "POST",
              `repos/${REPO}/issues/${cur.number}/dependencies/blocked_by`,
              { issue_id: depIssue.dbId },
              { allowFail: true },
            ),
          { lane: `blk-${it.id}`, soft: true },
        ),
      );
    }
    plan.check(S_RELATIONS, ops);
  }

  // Parked: label always; body only when this script wrote it (the marker), so hand-written issues stay.
  for (const p of parked) {
    const cur = state.parkedIssue.get(p);
    if (!cur) continue;
    const owned = cur.body.startsWith(PARKED_MARKER);
    const op = patchOp(`odłożone ${cur.number === null ? `"${p.title}"` : `#${cur.number}`}`, cur, {
      body: owned ? parkedBody(p) : undefined,
      labels: ["odłożone"],
      managed: new Set(),
    });
    plan.check(S_PARKED, op ? [op] : [], { counted: cur.number === null });
  }
}

/** The board itself: creation, the repo link, the Status options, the custom fields. Returns the op count. */
function planProjectStructure(plan) {
  const title = state.projectTitle;
  if (!state.projectRef) {
    // A dry run cannot see past creation; `main` prints one summary line instead.
    if (!APPLY) return 0;
    const ops = [
      mk(
        `projekt "${title}"`,
        async () => {
          const p = await ghJson(["project", "create", "--owner", OWNER, "--title", title, "--format", "json"]);
          state.projectRef = { id: p.id, number: p.number, title };
        },
        { lane: "proj" },
      ),
      mk(
        "opis projektu",
        () =>
          gh(
            [
              "project",
              "edit",
              String(state.projectRef.number),
              "--owner",
              OWNER,
              "--description",
              milestone.intent.slice(0, 250),
            ],
            { allowFail: true },
          ),
        { lane: "proj", soft: true },
      ),
    ];
    plan.check(S_PROJECT, ops);
    return ops.length;
  }

  const project = state.project;
  const pnum = String(project.number);
  const ops = [];

  // Linking is what makes the board show up in the repo's Projects tab. Checked on every run.
  if (!state.linkedProjects.includes(project.number)) {
    ops.push(
      mk(
        "podpięcie projektu do repo",
        () => gh(["project", "link", pnum, "--owner", OWNER, "--repo", REPO], { allowFail: true }),
        { lane: "proj", soft: true },
      ),
    );
  }

  // The board groups by the BUILT-IN Status field, so the roadmap states have to live there — a
  // parallel custom field would leave every card in "No Status".
  const statusField = project.fields.find((f) => f.name === "Status");
  if (statusField && BOARD_ORDER.some((o) => !statusField.options?.some((x) => x.name === o))) {
    ops.push(
      mk(
        "przestawienie wbudowanego pola Status na stany roadmapy",
        () =>
          graphql(
            `
              mutation ($field: ID!, $opts: [ProjectV2SingleSelectFieldOptionInput!]!) {
                updateProjectV2Field(input: { fieldId: $field, singleSelectOptions: $opts }) {
                  projectV2Field {
                    ... on ProjectV2SingleSelectField {
                      id
                    }
                  }
                }
              }
            `,
            {
              field: statusField.id,
              opts: BOARD_ORDER.map((name) => ({ name, color: STATUS_COLOR[name], description: "" })),
            },
            { soft: true },
          ),
        { lane: "proj" },
      ),
    );
  }

  // A leftover from an earlier run that duplicated Status; remove so the board has one truth.
  const legacy = project.fields.find((f) => f.name === "Stan roadmapy");
  if (legacy) {
    ops.push(
      mk(
        'usunięcie zdublowanego pola "Stan roadmapy"',
        () => gh(["project", "field-delete", "--id", legacy.id], { allowFail: true }),
        { lane: "proj", soft: true },
      ),
    );
  }

  const wanted = [
    { name: "Roadmap ID", type: "TEXT" },
    { name: "Strumień", type: "SINGLE_SELECT", options: streams.map((s) => `${s.key} · ${s.theme}`) },
    { name: "Rodzaj", type: "SINGLE_SELECT", options: ["Fundament", "Funkcja"] },
  ];
  for (const w of wanted) {
    if (project.fields.some((f) => f.name === w.name)) continue;
    ops.push(
      mk(
        `pole "${w.name}"`,
        () => {
          const args = ["project", "field-create", pnum, "--owner", OWNER, "--name", w.name, "--data-type", w.type];
          if (w.options) args.push("--single-select-options", w.options.join(","));
          return gh(args);
        },
        { lane: "proj" },
      ),
    );
  }
  plan.check(S_PROJECT, ops);
  return ops.length;
}

/** Stage C: cards, their field values, the named views and the readme. */
function planBoard(plan) {
  const project = state.project;
  const pnum = String(project.number);
  const fieldNamed = (name) => state.project.fields.find((f) => f.name === name);
  const optionId = (fieldName, optionName) => fieldNamed(fieldName)?.options?.find((o) => o.name === optionName)?.id;
  const itemIds = new Map();

  const targets = [
    ...items.map((it) => ({
      key: it.id,
      label: it.id,
      issue: state.itemIssue.get(it.id),
      desired: {
        "Roadmap ID": it.id,
        Strumień: it.stream,
        Rodzaj: it.isFoundation ? "Fundament" : "Funkcja",
        Status: STATUS_PL[it.status],
      },
    })),
    { key: "parent", label: milestone.tag, issue: state.parentIssue, desired: {} },
    ...parked.flatMap((p) => {
      const issue = state.parkedIssue.get(p);
      if (!issue) return [];
      const label = `odłożone ${issue.number === null ? `"${p.title}"` : `#${issue.number}`}`;
      return [{ key: `parked-${p.title}`, label, issue, desired: { Status: "Odłożone" } }];
    }),
  ];

  for (const t of targets) {
    const entry = t.issue.number === null ? undefined : project.items.find((i) => i.issue === t.issue.number);
    const lane = `item-${t.key}`;
    const ops = [];
    if (!entry) {
      ops.push(
        mk(
          `pozycja ${t.label} → projekt`,
          async () => {
            const added = await ghJson([
              "project",
              "item-add",
              pnum,
              "--owner",
              OWNER,
              "--url",
              `https://github.com/${REPO}/issues/${t.issue.number}`,
              "--format",
              "json",
            ]);
            itemIds.set(t.key, added?.id);
          },
          { lane },
        ),
      );
    }
    // Only a value that differs is written; a card already in its column costs nothing.
    for (const [fieldName, value] of Object.entries(t.desired)) {
      if (!value || entry?.values[fieldName] === value) continue;
      ops.push(
        mk(
          `${t.label}: ${fieldName} = ${value}`,
          async () => {
            const field = fieldNamed(fieldName);
            const itemId = entry?.id ?? itemIds.get(t.key);
            const isText = field?.options === undefined;
            const v = isText ? value : optionId(fieldName, value);
            if (!field || !itemId || !v) return;
            await gh(
              [
                "project",
                "item-edit",
                "--id",
                itemId,
                "--project-id",
                state.project.id,
                "--field-id",
                field.id,
                isText ? "--text" : "--single-select-option-id",
                v,
              ],
              { allowFail: true },
            );
          },
          { lane },
        ),
      );
    }
    plan.check(S_PROJECT, ops);
  }

  // Named views, created through GraphQL (gh has no `project view-create`). The API exposes name,
  // layout, visible fields and filter — grouping and sorting are UI-only, so the board relies on
  // Status grouping, which is the default.
  const col = (...names) => names.map((n) => fieldNamed(n)?.id).filter(Boolean);
  const views = [
    {
      name: "Tablica — przepływ",
      layout: "BOARD_LAYOUT",
      fields: ["Title", "Roadmap ID", "Strumień", "Rodzaj"],
      filter: "",
    },
    {
      name: "Tabela — cały plan",
      layout: "TABLE_LAYOUT",
      fields: ["Title", "Roadmap ID", "Strumień", "Rodzaj", "Status", "Milestone", "Labels"],
      filter: "",
    },
    {
      name: "Co blokuje postęp",
      layout: "TABLE_LAYOUT",
      fields: ["Title", "Roadmap ID", "Status", "Labels"],
      filter: 'label:"zablokowane: decyzja"',
    },
  ];
  for (const v of views) {
    if (project.views.some((e) => e.name === v.name)) {
      plan.check(S_PROJECT, []);
      continue;
    }
    plan.check(S_PROJECT, [
      mk(
        `widok "${v.name}"`,
        async () => {
          const created = await graphql(
            `
              mutation ($p: ID!, $n: String!, $l: ProjectV2ViewLayout!, $c: ProjectV2ViewConfigurationInput) {
                createProjectV2View(input: { projectId: $p, name: $n, layout: $l, configuration: $c }) {
                  projectV2View {
                    id
                  }
                }
              }
            `,
            { p: state.project.id, n: v.name, l: v.layout, c: { visibleFieldIds: col(...v.fields) } },
            { soft: true },
          );
          const viewId = created?.data?.createProjectV2View?.projectV2View?.id;
          if (viewId && v.filter) {
            await graphql(
              `
                mutation ($v: ID!, $f: String!) {
                  updateProjectV2View(input: { viewId: $v, filter: $f }) {
                    projectV2View {
                      id
                    }
                  }
                }
              `,
              { v: viewId, f: v.filter },
              { soft: true },
            );
          }
        },
        { lane: "views" },
      ),
    ]);
  }

  // GitHub seeds every new project with an unnamed "View 1"; drop it once the named views exist,
  // so nobody has to guess which lens is the real one.
  const placeholder = project.views.find((v) => v.name === "View 1");
  plan.check(
    S_PROJECT,
    placeholder
      ? [
          mk(
            'usunięcie domyślnego widoku "View 1"',
            () =>
              graphql(
                `
                  mutation ($v: ID!) {
                    deleteProjectV2View(input: { viewId: $v }) {
                      clientMutationId
                    }
                  }
                `,
                { v: placeholder.id },
                { soft: true },
              ),
            { lane: "views" },
          ),
        ]
      : [],
  );

  const readme = projectReadme(numbersMap(), state.parentIssue.number);
  plan.check(
    S_PROJECT,
    norm(project.readme) === norm(readme)
      ? []
      : [
          mk(
            "opis tablicy (README projektu)",
            () => gh(["project", "edit", pnum, "--owner", OWNER, "--readme", readme], { allowFail: true }),
            { lane: "readme", soft: true },
          ),
        ],
  );
}

/* ── step 3: execute ─────────────────────────────────────────────────────── */

let step = 0;
const pad = (n) => String(n).padStart(2);

function printSections(plan, { listOps }) {
  for (const [name, s] of plan.sections) {
    if (s.ok === 0 && s.ops.length === 0) continue;
    console.log(`\n${name}`);
    if (s.ok > 0) console.log(`  — ${s.ok} aktualne, bez zmian`);
    if (listOps) for (const o of s.ops) console.log(`  ${pad((step += 1))}. [plan] ${o.label}`);
  }
}

async function runLanes(list) {
  const lanes = new Map();
  let anon = 0;
  for (const o of list) {
    const key = o.lane ?? `__${anon++}`;
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key).push(o);
  }
  const queue = [...lanes.values()];
  let failure = null;
  const worker = async () => {
    for (let lane = queue.shift(); lane && !failure; lane = queue.shift()) {
      for (const o of lane) {
        if (failure) return;
        console.log(`  ${pad((step += 1))}. ${o.label}`);
        try {
          const result = await o.run();
          if (o.soft && result === null) console.log("     ! operacja nie powiodła się — pominięto");
        } catch (err) {
          failure = err;
          return;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failure) throw failure;
}

/** Runs a plan's operations phase by phase; within a phase lanes run concurrently, each lane in order. */
async function execute(plan) {
  printSections(plan, { listOps: false });
  const ops = plan.ops;
  for (const phase of [...new Set(ops.map((o) => o.phase ?? 0))].sort((a, b) => a - b)) {
    await runLanes(ops.filter((o) => (o.phase ?? 0) === phase));
  }
}

/* ── main ────────────────────────────────────────────────────────────────── */

/**
 * Lifts each item's status to the most advanced candidate (see the header): the worktree hints plus
 * the card's current column, so a card another session moved forward is never pulled back. Runs
 * before the diff, so bodies, labels, open/closed and the board all agree with the lifted status.
 */
function liftStatuses() {
  if (ALLOW_REGRESS) {
    console.log("--allow-regress: stany wyłącznie z tego roadmap.md (bez worktree i tablicy)");
    return;
  }
  const fromBoard = Object.fromEntries(Object.entries(STATUS_PL).map(([k, v]) => [v, k]));
  const lifts = [];
  for (const it of items) {
    if (!(it.status in STATUS_RANK)) continue;
    const candidates = [...(hints.get(it.id) ?? [])];
    const card = state.project?.items.find((i) => i.values["Roadmap ID"] === it.id);
    const column = card?.values.Status;
    if (column && fromBoard[column]) candidates.push({ status: fromBoard[column], from: `tablica (${column})` });
    let best = { status: it.status, from: null };
    for (const c of candidates) {
      if ((STATUS_RANK[c.status] ?? -1) > STATUS_RANK[best.status]) best = c;
    }
    if (best.from === null) continue;
    lifts.push(`  ${it.id}: ${STATUS_PL[it.status]} → ${STATUS_PL[best.status]} — ${best.from}`);
    it.status = best.status;
  }
  if (lifts.length === 0) return;
  console.log("\nStany podniesione ponad ten roadmap.md (stan nigdy się nie cofa; --allow-regress, żeby cofnąć):");
  for (const line of lifts) console.log(line);
  console.log(`Uzupełnij ${ROADMAP}, jeśli to ten worktree jest w tyle.`);
}

async function main() {
  console.log(`${APPLY ? "APPLY" : "PLAN (nic nie zostanie utworzone — dodaj --apply)"}  repo=${REPO}`);
  console.log(
    `Kamień milowy: ${milestone.tag}: ${milestone.name} · ${items.length} pozycji · gwiazda: ${northStar ?? "—"}`,
  );

  const previewIdx = process.argv.indexOf("--preview");
  if (previewIdx !== -1) {
    const want = (process.argv[previewIdx + 1] ?? "").toUpperCase();
    const fake = Object.fromEntries(items.map((it, i) => [it.id, i + 1]));
    const body =
      want === milestone.tag || want === "M"
        ? parentBody(fake)
        : issueBody(items.find((it) => it.id === want) ?? items[0], fake);
    console.log(`\n${"─".repeat(70)}\n${body}\n${"─".repeat(70)}`);
    console.log("(numery #N są zmyślone na potrzeby podglądu)");
    return;
  }

  // Step 1 — fetch.
  const started = Date.now();
  state = await fetchState();
  console.log(
    `Pobrano stan GitHuba: ${state.issues.length} issues, ${state.labels.size} etykiet, ${state.project ? `${state.project.items.length} pozycji tablicy` : "brak tablicy"} (${((Date.now() - started) / 1000).toFixed(1)} s, konto ${state.viewer})`,
  );

  if (APPLY && !["ADMIN", "MAINTAIN", "WRITE"].includes(state.permission)) {
    console.error(
      `\nBrak prawa zapisu do ${REPO} (zalogowany jako ${state.viewer}).\n` +
        `Użyj konta z dostępem, np.:\n  GH_TOKEN=$(gh auth token --user Mr1008) node scripts/roadmap-to-github.mjs --apply\n`,
    );
    process.exit(1);
  }

  liftStatuses();

  // Step 2 — diff. A dry run plans every stage at once, with stand-ins for what does not exist yet;
  // --apply plans stage by stage, because later stages need the real numbers of earlier ones.
  const baseOps = new Plan();
  planBase(baseOps);

  if (!APPLY) {
    const plan = baseOps;
    for (const o of plan.ops) o.simulate?.();
    planIssues(plan);
    planProjectStructure(plan);
    if (state.project) planBoard(plan);
    else {
      // The board does not exist yet: one summary line, like the plan has always shown.
      const cards = items.length + 1 + parked.length;
      plan.check(S_PROJECT, [
        mk(
          `projekt "${state.projectTitle}" + pola (Roadmap ID, Strumień, Rodzaj) + stany na wbudowanym Status + 3 widoki + README + ${cards} pozycji (w tym odłożone)`,
          () => null,
        ),
      ]);
    }
    printSections(plan, { listOps: true });
    console.log(
      `\nPodsumowanie: ${plan.ok} aktualnych, ${plan.changed} do zmiany (${plan.ops.length} ${plan.ops.length === 1 ? "operacja" : "operacji"}).`,
    );
    console.log("Plan gotowy. Uruchom z --apply, żeby wykonać.");
    return;
  }

  // Step 3 — execute.
  console.log("\n— Etap 1: etykiety, milestone, nowe issues");
  await execute(baseOps);

  console.log("\n— Etap 2: opisy, etykiety, stany, relacje, tablica (struktura)");
  const stageTwo = new Plan();
  planIssues(stageTwo);
  let structural = planProjectStructure(stageTwo);
  await execute(stageTwo);

  if (!state.project && state.projectRef) {
    state.project = await fetchProject(state.projectRef.id);
    const created = new Plan();
    structural += planProjectStructure(created);
    await execute(created);
  }
  // Field and option ids change when the structure does, so read the board once more.
  if (structural > 0) state.project = await fetchProject(state.projectRef.id);

  console.log("\n— Etap 3: pozycje tablicy, widoki, README");
  const stageThree = new Plan();
  planBoard(stageThree);
  await execute(stageThree);

  const numbers = numbersMap();
  const parkedNumbers = new Map([...state.parkedIssue].map(([p, issue]) => [p, issue.number]));
  console.log(`\n  Tablica: https://github.com/users/${OWNER}/projects/${state.project.number}`);
  if (WRITE_BACK) writeBack(numbers, parkedNumbers);
  console.log("\nGotowe.");
}

await main();
