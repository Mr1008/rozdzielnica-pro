#!/usr/bin/env node
/**
 * Mirror `context/foundation/roadmap.md` into GitHub issues, labels, a milestone
 * and a Projects v2 board.
 *
 * roadmap.md stays the contract the /10x-* skills read; GitHub is the tracking and
 * communication surface. Re-running the script syncs GitHub to the file — it never
 * invents work and never deletes anything.
 *
 *   node scripts/roadmap-to-github.mjs            # plan only, touches nothing
 *   node scripts/roadmap-to-github.mjs --apply    # create/update on GitHub
 *
 * The active `gh` account must have write access to REPO. To use a non-active
 * account for one run:
 *
 *   GH_TOKEN=$(gh auth token --user Mr1008) node scripts/roadmap-to-github.mjs --apply
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.env.ROADMAP_REPO ?? "Mr1008/rozdzielnica-pro";
const [OWNER] = REPO.split("/");
const ROADMAP = "context/foundation/roadmap.md";
const APPLY = process.argv.includes("--apply");
const WRITE_BACK = APPLY && !process.argv.includes("--no-write-back");

const tmp = mkdtempSync(join(tmpdir(), "roadmap-gh-"));
let step = 0;

/* ── gh plumbing ─────────────────────────────────────────────────────────── */

function gh(args, { allowFail = false } = {}) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch (err) {
    if (allowFail) return null;
    const detail = [err.stderr, err.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed:\n${detail || err.message}`, { cause: err });
  }
}

const ghJson = (args, opts) => {
  const out = gh(args, opts);
  return out ? JSON.parse(out) : null;
};

/**
 * GraphQL with structured variables. `gh api graphql -f` only takes scalars, so the
 * whole body goes through a temp JSON file — that also keeps Polish text intact.
 */
let gqlSeq = 0;
function graphql(query, variables) {
  const path = join(tmp, `gql-${++gqlSeq}.json`);
  writeFileSync(path, JSON.stringify({ query, variables }), "utf8");
  const out = gh(["api", "graphql", "--input", path], { allowFail: true });
  if (!out) return null;
  const parsed = JSON.parse(out);
  if (parsed.errors) console.log(`     ! GraphQL: ${parsed.errors.map((e) => e.message).join("; ")}`);
  return parsed;
}

/** Colours for the built-in Status options, so the board reads at a glance. */
const STATUS_COLOR = {
  Zablokowane: "RED",
  Propozycja: "GRAY",
  "Gotowe do planowania": "GREEN",
  "W planowaniu": "BLUE",
  "W realizacji": "YELLOW",
  Zrobione: "PURPLE",
};

/** Writes `body` to a temp file so no shell quoting or encoding can mangle it. */
function bodyFile(name, body) {
  const path = join(tmp, `${name}.md`);
  writeFileSync(path, body, "utf8");
  return path;
}

function act(label, fn) {
  step += 1;
  if (!APPLY) {
    console.log(`  ${String(step).padStart(2)}. [plan] ${label}`);
    return null;
  }
  console.log(`  ${String(step).padStart(2)}. ${label}`);
  return fn();
}

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

/* ── sync steps ──────────────────────────────────────────────────────────── */

function syncLabels() {
  console.log("\nEtykiety");
  for (const l of LABELS) {
    act(`label "${l.name}"`, () =>
      gh(["label", "create", l.name, "--repo", REPO, "--color", l.color, "--description", l.description, "--force"]),
    );
  }
}

function syncMilestone() {
  console.log("\nMilestone");
  const title = `${milestone.tag}: ${milestone.name}`;
  const existing = APPLY
    ? (ghJson(["api", `repos/${REPO}/milestones?state=all`]) ?? []).find((m) => m.title === title)
    : null;
  if (existing) {
    console.log(`  — milestone "${title}" już istnieje (#${existing.number})`);
    return title;
  }
  act(`milestone "${title}"`, () =>
    gh([
      "api",
      `repos/${REPO}/milestones`,
      "-X",
      "POST",
      "-f",
      `title=${title}`,
      "-f",
      `description=${milestone.intent} | Gotowe, gdy: ${milestone.doneWhen}`,
    ]),
  );
  return title;
}

function existingIssues() {
  if (!APPLY) return [];
  return ghJson(["issue", "list", "--repo", REPO, "--state", "all", "--limit", "200", "--json", "number,title"]) ?? [];
}

function syncIssues(milestoneTitle) {
  console.log("\nIssues");
  const existing = existingIssues();
  const numbers = {};
  const find = (title) => existing.find((e) => e.title === title);

  // pass 1 — create or locate, so cross-references can use real numbers
  for (const it of items) {
    const title = issueTitle(it);
    const hit = find(title);
    if (hit) {
      numbers[it.id] = hit.number;
      console.log(`  — ${it.id} już istnieje jako #${hit.number}`);
      continue;
    }
    const n = act(`issue "${title}"`, () => {
      const args = [
        "issue",
        "create",
        "--repo",
        REPO,
        "--title",
        title,
        "--body-file",
        bodyFile(it.id, "(tworzenie...)"),
        "--milestone",
        milestoneTitle,
      ];
      for (const l of labelsFor(it)) args.push("--label", l);
      const url = gh(args);
      return Number(url.trim().split("/").pop());
    });
    if (n) numbers[it.id] = n;
  }

  const parentTitle = `${milestone.tag} · ${milestone.name}`;
  const parentHit = find(parentTitle);
  let parent = parentHit?.number ?? null;
  if (parentHit) console.log(`  — issue-parasol już istnieje jako #${parent}`);
  else {
    parent = act(`issue-parasol "${parentTitle}"`, () => {
      const url = gh([
        "issue",
        "create",
        "--repo",
        REPO,
        "--title",
        parentTitle,
        "--body-file",
        bodyFile("parent", "(tworzenie...)"),
        "--milestone",
        milestoneTitle,
      ]);
      return Number(url.trim().split("/").pop());
    });
  }

  // pass 2 — bodies and labels, now that every number is known.
  // Labels this script owns are reconciled in both directions, so a status flip in
  // roadmap.md (blocked → ready, say) removes the stale label instead of stacking.
  const managed = new Set(LABELS.map((l) => l.name));
  for (const it of items) {
    act(`opis + etykiety ${it.id}`, () => {
      const current = (
        ghJson(["issue", "view", String(numbers[it.id]), "--repo", REPO, "--json", "labels"])?.labels ?? []
      ).map((l) => l.name);
      const wanted = labelsFor(it);
      const args = [
        "issue",
        "edit",
        String(numbers[it.id]),
        "--repo",
        REPO,
        "--body-file",
        bodyFile(`${it.id}-body`, issueBody(it, numbers)),
      ];
      for (const l of wanted) if (!current.includes(l)) args.push("--add-label", l);
      for (const l of current) if (managed.has(l) && !wanted.includes(l)) args.push("--remove-label", l);
      gh(args);
    });
  }
  act(`opis issue-parasola`, () =>
    gh([
      "issue",
      "edit",
      String(parent),
      "--repo",
      REPO,
      "--body-file",
      bodyFile("parent-body", parentBody(numbers)),
      "--add-label",
      "kamień milowy",
    ]),
  );

  return { numbers, parent };
}

const restId = (n) => ghJson(["api", `repos/${REPO}/issues/${n}`, "-q", ".id"]);

function syncRelations({ numbers, parent }) {
  console.log("\nRelacje (sub-issues + blocked by)");
  if (!APPLY) {
    for (const it of items) {
      step += 1;
      console.log(
        `  ${String(step).padStart(2)}. [plan] ${it.id}: parent=${milestone.tag}${it.prerequisites.length ? `, blocked by ${it.prerequisites.join(", ")}` : ""}`,
      );
    }
    return;
  }

  const ids = Object.fromEntries(items.map((it) => [it.id, restId(numbers[it.id])]));
  const children = (ghJson(["api", `repos/${REPO}/issues/${parent}/sub_issues`], { allowFail: true }) ?? []).map(
    (c) => c.number,
  );

  for (const it of items) {
    if (children.includes(numbers[it.id])) {
      console.log(`  — ${it.id} jest już pod-zadaniem parasola`);
    } else {
      act(`${it.id} → pod-zadanie #${parent}`, () =>
        gh(["api", `repos/${REPO}/issues/${parent}/sub_issues`, "-X", "POST", "-F", `sub_issue_id=${ids[it.id]}`], {
          allowFail: true,
        }),
      );
    }

    const current = (
      ghJson(["api", `repos/${REPO}/issues/${numbers[it.id]}/dependencies/blocked_by`], { allowFail: true }) ?? []
    ).map((d) => d.number);
    for (const dep of it.prerequisites) {
      if (current.includes(numbers[dep])) {
        console.log(`  — ${it.id} jest już zablokowany przez ${dep}`);
        continue;
      }
      act(`${it.id} blocked by ${dep}`, () =>
        gh(
          [
            "api",
            `repos/${REPO}/issues/${numbers[it.id]}/dependencies/blocked_by`,
            "-X",
            "POST",
            "-F",
            `issue_id=${ids[dep]}`,
          ],
          { allowFail: true },
        ),
      );
    }
  }
}

function syncProject({ numbers, parent }) {
  console.log("\nProject");
  const title = `RozdzielnicaPro — ${milestone.tag}: ${milestone.name}`;
  if (!APPLY) {
    step += 1;
    console.log(
      `  ${String(step).padStart(2)}. [plan] projekt "${title}" + pola (Roadmap ID, Strumień, Rodzaj) + stany na wbudowanym Status + 3 widoki + README + ${items.length + 1} pozycji`,
    );
    return;
  }

  const list = ghJson(["project", "list", "--owner", OWNER, "--format", "json", "--limit", "100"])?.projects ?? [];
  let project = list.find((p) => p.title === title);
  if (project) console.log(`  — projekt już istnieje (#${project.number})`);
  else {
    project = act(`projekt "${title}"`, () =>
      ghJson(["project", "create", "--owner", OWNER, "--title", title, "--format", "json"]),
    );
    act("opis projektu", () =>
      gh(
        [
          "project",
          "edit",
          String(project.number),
          "--owner",
          OWNER,
          "--description",
          `${milestone.intent}`.slice(0, 250),
        ],
        { allowFail: true },
      ),
    );
  }

  const pnum = String(project.number);
  const pid = project.id ?? ghJson(["project", "view", pnum, "--owner", OWNER, "--format", "json"]).id;

  // The board lives under the user account; linking is what makes it show up in the
  // repo's Projects tab. Checked on every run, not just on creation.
  const linked = (
    ghJson([
      "api",
      "graphql",
      "-f",
      `query={ repository(owner:"${OWNER}", name:"${REPO.split("/")[1]}"){ projectsV2(first:20){ nodes{ number } } } }`,
    ])?.data?.repository?.projectsV2?.nodes ?? []
  ).map((n) => n.number);
  if (linked.includes(project.number)) console.log("  — projekt jest już podpięty do repo (zakładka Projects)");
  else
    act("podpięcie projektu do repo", () =>
      gh(["project", "link", pnum, "--owner", OWNER, "--repo", REPO], { allowFail: true }),
    );

  const wanted = [
    { name: "Roadmap ID", type: "TEXT" },
    { name: "Strumień", type: "SINGLE_SELECT", options: streams.map((s) => `${s.key} · ${s.theme}`) },
    { name: "Rodzaj", type: "SINGLE_SELECT", options: ["Fundament", "Funkcja"] },
  ];
  let fields = ghJson(["project", "field-list", pnum, "--owner", OWNER, "--format", "json", "--limit", "50"]).fields;

  // The board groups by the BUILT-IN Status field, so the roadmap states have to live
  // there — a parallel custom field would leave every card in "No Status".
  const statusField = fields.find((f) => f.name === "Status");
  const boardOrder = ["Zablokowane", "Propozycja", "Gotowe do planowania", "W planowaniu", "W realizacji", "Zrobione"];
  if (statusField && boardOrder.some((o) => !statusField.options?.some((x) => x.name === o))) {
    act("przestawienie wbudowanego pola Status na stany roadmapy", () =>
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
          opts: boardOrder.map((name) => ({ name, color: STATUS_COLOR[name], description: "" })),
        },
      ),
    );
  } else if (statusField) console.log("  — wbudowane pole Status ma już stany roadmapy");

  // A leftover from an earlier run that duplicated Status; remove so the board has one truth.
  const legacy = fields.find((f) => f.name === "Stan roadmapy");
  if (legacy)
    act('usunięcie zdublowanego pola "Stan roadmapy"', () =>
      gh(["project", "field-delete", "--id", legacy.id], { allowFail: true }),
    );
  for (const w of wanted) {
    if (fields.some((f) => f.name === w.name)) {
      console.log(`  — pole "${w.name}" już istnieje`);
      continue;
    }
    act(`pole "${w.name}"`, () => {
      const args = ["project", "field-create", pnum, "--owner", OWNER, "--name", w.name, "--data-type", w.type];
      if (w.options) args.push("--single-select-options", w.options.join(","));
      gh(args);
    });
  }
  fields = ghJson(["project", "field-list", pnum, "--owner", OWNER, "--format", "json", "--limit", "50"]).fields;
  const fieldBy = Object.fromEntries(fields.map((f) => [f.name, f]));
  const optionId = (fieldName, optionName) => fieldBy[fieldName]?.options?.find((o) => o.name === optionName)?.id;

  const existingItems =
    ghJson(["project", "item-list", pnum, "--owner", OWNER, "--format", "json", "--limit", "200"]).items ?? [];
  const itemFor = (issueNumber) => existingItems.find((i) => i.content?.number === issueNumber);

  for (const it of [...items, null]) {
    const issueNumber = it ? numbers[it.id] : parent;
    const label = it ? it.id : milestone.tag;
    let entry = itemFor(issueNumber);
    if (!entry) {
      entry = act(`pozycja ${label} → projekt`, () =>
        ghJson([
          "project",
          "item-add",
          pnum,
          "--owner",
          OWNER,
          "--url",
          `https://github.com/${REPO}/issues/${issueNumber}`,
          "--format",
          "json",
        ]),
      );
    } else console.log(`  — ${label} jest już na tablicy`);
    if (!entry || !it) continue;

    const set = (fieldName, flag, value) => {
      if (!value || !fieldBy[fieldName]) return;
      act(`${label}: ${fieldName} = ${value}`, () =>
        gh(
          [
            "project",
            "item-edit",
            "--id",
            entry.id,
            "--project-id",
            pid,
            "--field-id",
            fieldBy[fieldName].id,
            flag,
            value,
          ],
          { allowFail: true },
        ),
      );
    };
    set("Roadmap ID", "--text", it.id);
    set("Strumień", "--single-select-option-id", optionId("Strumień", it.stream));
    set("Rodzaj", "--single-select-option-id", optionId("Rodzaj", it.isFoundation ? "Fundament" : "Funkcja"));
    set("Status", "--single-select-option-id", optionId("Status", STATUS_PL[it.status]));
  }

  syncViews(pid, fieldBy);
  act("opis tablicy (README projektu)", () =>
    gh(["project", "edit", pnum, "--owner", OWNER, "--readme", projectReadme(numbers, parent)], { allowFail: true }),
  );

  console.log(`\n  Tablica: https://github.com/users/${OWNER}/projects/${pnum}`);
}

/**
 * Named views, created through GraphQL (gh has no `project view-create`).
 * The API exposes name, layout, visible fields and filter — grouping and sorting
 * are UI-only, so the board relies on Status grouping, which is the default.
 */
function syncViews(pid, fieldBy) {
  const existing =
    graphql(
      `
        query ($id: ID!) {
          node(id: $id) {
            ... on ProjectV2 {
              views(first: 20) {
                nodes {
                  id
                  name
                }
              }
            }
          }
        }
      `,
      { id: pid },
    )?.data?.node?.views?.nodes ?? [];

  const col = (...names) => names.map((n) => fieldBy[n]?.id).filter(Boolean);
  const views = [
    {
      name: "Tablica — przepływ",
      layout: "BOARD_LAYOUT",
      fields: col("Title", "Roadmap ID", "Strumień", "Rodzaj"),
      filter: "",
    },
    {
      name: "Tabela — cały plan",
      layout: "TABLE_LAYOUT",
      fields: col("Title", "Roadmap ID", "Strumień", "Rodzaj", "Status", "Milestone", "Labels"),
      filter: "",
    },
    {
      name: "Co blokuje postęp",
      layout: "TABLE_LAYOUT",
      fields: col("Title", "Roadmap ID", "Status", "Labels"),
      filter: 'label:"zablokowane: decyzja"',
    },
  ];

  for (const v of views) {
    const hit = existing.find((e) => e.name === v.name);
    if (hit) {
      console.log(`  — widok "${v.name}" już istnieje`);
      continue;
    }
    act(`widok "${v.name}"`, () => {
      const created = graphql(
        `
          mutation ($p: ID!, $n: String!, $l: ProjectV2ViewLayout!, $c: ProjectV2ViewConfigurationInput) {
            createProjectV2View(input: { projectId: $p, name: $n, layout: $l, configuration: $c }) {
              projectV2View {
                id
              }
            }
          }
        `,
        { p: pid, n: v.name, l: v.layout, c: { visibleFieldIds: v.fields } },
      );
      const viewId = created?.data?.createProjectV2View?.projectV2View?.id;
      if (viewId && v.filter)
        graphql(
          `
            mutation ($v: ID!, $f: String!) {
              updateProjectV2View(input: { viewId: $v, filter: $f }) {
                projectV2View {
                  id
                }
              }
            }
          `,
          {
            v: viewId,
            f: v.filter,
          },
        );
    });
  }

  // GitHub seeds every new project with an unnamed "View 1"; drop it once the named
  // views exist, so nobody has to guess which lens is the real one.
  const placeholder = (
    graphql(
      `
        query ($id: ID!) {
          node(id: $id) {
            ... on ProjectV2 {
              views(first: 20) {
                nodes {
                  id
                  name
                }
              }
            }
          }
        }
      `,
      {
        id: pid,
      },
    )?.data?.node?.views?.nodes ?? []
  ).find((v) => v.name === "View 1");
  if (placeholder)
    act('usunięcie domyślnego widoku "View 1"', () =>
      graphql(
        `
          mutation ($v: ID!) {
            deleteProjectV2View(input: { viewId: $v }) {
              clientMutationId
            }
          }
        `,
        {
          v: placeholder.id,
        },
      ),
    );
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

/** Adds `- **Issue:** #N` to each roadmap item so the link is bidirectional. */
function writeBack(numbers) {
  console.log("\nLinkowanie zwrotne w roadmap.md");
  let out = md;
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

/* ── main ────────────────────────────────────────────────────────────────── */

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
  process.exit(0);
}

if (APPLY) {
  const perms = ghJson(["api", `repos/${REPO}`, "-q", ".permissions.push"], { allowFail: true });
  if (perms !== true) {
    const who = gh(["api", "user", "-q", ".login"], { allowFail: true }) ?? "?";
    console.error(
      `\nBrak prawa zapisu do ${REPO} (zalogowany jako ${who}).\n` +
        `Użyj konta z dostępem, np.:\n  GH_TOKEN=$(gh auth token --user Mr1008) node scripts/roadmap-to-github.mjs --apply\n`,
    );
    process.exit(1);
  }
}

syncLabels();
const milestoneTitle = syncMilestone();
const issues = syncIssues(milestoneTitle);
syncRelations(issues);
syncProject(issues);
if (WRITE_BACK) writeBack(issues.numbers);

console.log(`\n${APPLY ? "Gotowe." : "Plan gotowy. Uruchom z --apply, żeby wykonać."}`);
