import { describe, expect, it } from "vitest";
import {
  CIRCUIT_FIELDS,
  CIRCUIT_ISSUE_CODES,
  GROUP_FIELDS,
  MAX_CIRCUITS,
  MAX_CIRCUIT_NAME_LENGTH,
  MAX_GROUPS,
  MAX_GROUP_LABEL_LENGTH,
  circuitIssueMessage,
  parseCircuitsPayload,
  type CircuitIssue,
} from "./circuit-params";

const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const CIRCUIT_ID = "22222222-2222-4222-8222-222222222222";
const CIRCUIT_ID_2 = "33333333-3333-4333-8333-333333333333";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

const GROUP = { id: GROUP_ID, label: "RCD 1", residual_current_ma: 30, min_rcd_type: "A", rcd_margin_percent: 15 };
const CIRCUIT = {
  id: CIRCUIT_ID,
  rcd_group_id: GROUP_ID,
  name: "Gniazda kuchnia",
  rated_current_a: 16,
  phase_count: 1,
  cross_section_mm2: 2.5,
  installation: "conduit_flush",
  entry_side: "top",
};
const UNGROUPED = { ...CIRCUIT, id: CIRCUIT_ID_2, rcd_group_id: null, name: "Oświetlenie" };

function payload(overrides: { groups?: unknown; circuits?: unknown } = {}) {
  return { groups: [GROUP], circuits: [CIRCUIT, UNGROUPED], ...overrides };
}

function issuesOf(raw: unknown): CircuitIssue[] {
  const result = parseCircuitsPayload(raw);
  return result.ok ? [] : result.issues;
}

function codesOn(raw: unknown, field: string): string[] {
  return issuesOf(raw)
    .filter((issue) => issue.field === field)
    .map((issue) => issue.code);
}

describe("parseCircuitsPayload", () => {
  it("accepts a valid payload and returns the row shapes", () => {
    const result = parseCircuitsPayload(payload());
    expect(result).toEqual({ ok: true, value: { groups: [GROUP], circuits: [CIRCUIT, UNGROUPED] } });
  });

  it("accepts an empty payload", () => {
    expect(parseCircuitsPayload({ groups: [], circuits: [] })).toEqual({
      ok: true,
      value: { groups: [], circuits: [] },
    });
  });

  it("re-parses stored rows unchanged, dropping keys that are not row fields", () => {
    const stored = payload({
      groups: [{ ...GROUP, project_id: uuid(9), position: 0 }],
      circuits: [
        { ...CIRCUIT, project_id: uuid(9), position: 0 },
        { ...UNGROUPED, project_id: uuid(9), position: 1 },
      ],
    });
    const first = parseCircuitsPayload(stored);
    expect(first).toEqual({ ok: true, value: { groups: [GROUP], circuits: [CIRCUIT, UNGROUPED] } });
    if (!first.ok) return;
    expect(parseCircuitsPayload(first.value)).toEqual(first);
  });

  it("trims names and labels", () => {
    const result = parseCircuitsPayload(
      payload({ groups: [{ ...GROUP, label: "  RCD 1 " }], circuits: [{ ...CIRCUIT, name: "  Gniazda kuchnia\t" }] }),
    );
    expect(result.ok && result.value.groups[0].label).toBe("RCD 1");
    expect(result.ok && result.value.circuits[0].name).toBe("Gniazda kuchnia");
  });

  it("treats an absent rcd_group_id as no group", () => {
    const { rcd_group_id: _dropped, ...withoutGroup } = CIRCUIT;
    const result = parseCircuitsPayload(payload({ circuits: [withoutGroup] }));
    expect(result.ok && result.value.circuits[0].rcd_group_id).toBeNull();
  });

  it.each([
    ["a non-object", "circuits"],
    ["an array", []],
    ["null", null],
  ])("rejects %s as a malformed payload", (_label, raw) => {
    expect(issuesOf(raw)).toEqual([{ scope: "payload", index: null, id: null, field: null, code: "malformed" }]);
  });

  it("rejects missing or non-array lists", () => {
    expect(issuesOf({ circuits: [] })).toEqual([
      { scope: "group", index: null, id: null, field: null, code: "required" },
    ]);
    expect(issuesOf({ groups: [], circuits: {} })).toEqual([
      { scope: "circuit", index: null, id: null, field: null, code: "malformed" },
    ]);
  });

  it("rejects a non-object item", () => {
    expect(issuesOf(payload({ circuits: ["x"] }))).toEqual([
      { scope: "circuit", index: 0, id: null, field: null, code: "malformed" },
    ]);
  });

  describe("value lists", () => {
    it.each([
      ["residual_current_ma", [20, 0, "30"]],
      ["min_rcd_type", ["C", "a", 1]],
      ["rcd_margin_percent", [7, -5, "15", 100]],
    ])("rejects a group %s outside its list", (field, values) => {
      for (const value of values) {
        expect(codesOn(payload({ groups: [{ ...GROUP, [field]: value }] }), field)).toEqual(["not_in_list"]);
      }
    });

    it.each([
      ["rated_current_a", [5, 15, 64, "16"]],
      ["phase_count", [0, 2, "1"]],
      ["cross_section_mm2", [1, 2, 25, "2.5"]],
      ["installation", ["under_floor", "Surface"]],
      ["entry_side", ["front", "Top"]],
    ])("rejects a circuit %s outside its list", (field, values) => {
      for (const value of values) {
        expect(codesOn(payload({ circuits: [{ ...CIRCUIT, [field]: value }] }), field)).toEqual(["not_in_list"]);
      }
    });

    it("reports an absent list value as required", () => {
      expect(codesOn(payload({ circuits: [{ ...CIRCUIT, rated_current_a: null }] }), "rated_current_a")).toEqual([
        "required",
      ]);
      expect(codesOn(payload({ groups: [{ ...GROUP, min_rcd_type: undefined }] }), "min_rcd_type")).toEqual([
        "required",
      ]);
    });
  });

  describe("ids", () => {
    it("requires every id to be a UUID", () => {
      const issues = issuesOf(
        payload({ groups: [{ ...GROUP, id: "g1" }], circuits: [{ ...CIRCUIT, id: 7, rcd_group_id: "g1" }] }),
      );
      expect(issues).toContainEqual({ scope: "group", index: 0, id: null, field: "id", code: "malformed" });
      expect(issues).toContainEqual({ scope: "circuit", index: 0, id: null, field: "id", code: "malformed" });
      expect(issues).toContainEqual({ scope: "circuit", index: 0, id: null, field: "rcd_group_id", code: "malformed" });
    });

    it("requires an id", () => {
      expect(codesOn(payload({ circuits: [{ ...CIRCUIT, id: null }] }), "id")).toEqual(["required"]);
    });

    it("rejects an id repeated across groups and circuits", () => {
      const issues = issuesOf(payload({ circuits: [{ ...CIRCUIT, id: GROUP_ID }] }));
      expect(issues).toEqual([{ scope: "circuit", index: 0, id: GROUP_ID, field: "id", code: "duplicate_id" }]);
    });

    it("rejects an id repeated within one list, case-insensitively", () => {
      const issues = issuesOf(payload({ circuits: [CIRCUIT, { ...UNGROUPED, id: CIRCUIT_ID.toUpperCase() }] }));
      expect(issues).toEqual([
        { scope: "circuit", index: 1, id: CIRCUIT_ID.toUpperCase(), field: "id", code: "duplicate_id" },
      ]);
    });

    it("rejects a circuit pointing at a group not in the payload", () => {
      const issues = issuesOf(payload({ groups: [] }));
      expect(issues).toEqual([
        { scope: "circuit", index: 0, id: CIRCUIT_ID, field: "rcd_group_id", code: "unknown_group" },
      ]);
    });

    it("does not let a circuit id stand in for a group", () => {
      const issues = issuesOf(payload({ circuits: [{ ...CIRCUIT, rcd_group_id: CIRCUIT_ID_2 }, UNGROUPED] }));
      expect(issues.map((issue) => issue.code)).toEqual(["unknown_group"]);
    });
  });

  describe("text", () => {
    it("rejects an empty or whitespace-only name and label", () => {
      expect(codesOn(payload({ circuits: [{ ...CIRCUIT, name: "   " }] }), "name")).toEqual(["required"]);
      expect(codesOn(payload({ groups: [{ ...GROUP, label: "" }] }), "label")).toEqual(["required"]);
      expect(codesOn(payload({ groups: [{ ...GROUP, label: 5 }] }), "label")).toEqual(["malformed"]);
    });

    it("counts code points, not UTF-16 units", () => {
      const emoji = "🔌"; // one code point, two UTF-16 units
      const atLimit = emoji.repeat(MAX_CIRCUIT_NAME_LENGTH);
      expect(atLimit.length).toBe(MAX_CIRCUIT_NAME_LENGTH * 2);
      expect(parseCircuitsPayload(payload({ circuits: [{ ...CIRCUIT, name: atLimit }] })).ok).toBe(true);
      expect(codesOn(payload({ circuits: [{ ...CIRCUIT, name: `${atLimit}a` }] }), "name")).toEqual(["too_long"]);
    });

    it("measures the trimmed text", () => {
      const label = `  ${"x".repeat(MAX_GROUP_LABEL_LENGTH)}  `;
      expect(parseCircuitsPayload(payload({ groups: [{ ...GROUP, label }] })).ok).toBe(true);
      const tooLong = "x".repeat(MAX_GROUP_LABEL_LENGTH + 1);
      expect(codesOn(payload({ groups: [{ ...GROUP, label: tooLong }] }), "label")).toEqual(["too_long"]);
    });
  });

  describe("limits", () => {
    it("rejects too many circuits", () => {
      const circuits = Array.from({ length: MAX_CIRCUITS + 1 }, (_, i) => ({ ...UNGROUPED, id: uuid(i + 1) }));
      expect(issuesOf({ groups: [], circuits })).toEqual([
        { scope: "circuit", index: null, id: null, field: null, code: "too_many" },
      ]);
      expect(parseCircuitsPayload({ groups: [], circuits: circuits.slice(1) }).ok).toBe(true);
    });

    it("rejects too many groups", () => {
      const groups = Array.from({ length: MAX_GROUPS + 1 }, (_, i) => ({ ...GROUP, id: uuid(i + 1) }));
      expect(issuesOf({ groups, circuits: [] })).toEqual([
        { scope: "group", index: null, id: null, field: null, code: "too_many" },
      ]);
    });
  });

  it("reports every problem at once", () => {
    const issues = issuesOf(
      payload({
        groups: [{ ...GROUP, label: "", residual_current_ma: 25 }],
        circuits: [{ ...CIRCUIT, rated_current_a: 17, entry_side: "front" }],
      }),
    );
    expect(issues.map((issue) => `${issue.scope}.${String(issue.field)}.${issue.code}`)).toEqual([
      "group.label.required",
      "group.residual_current_ma.not_in_list",
      "circuit.rated_current_a.not_in_list",
      "circuit.entry_side.not_in_list",
    ]);
  });

  it("never throws", () => {
    for (const raw of [undefined, 0, "", Symbol("x"), { groups: [null], circuits: [[], 1] }]) {
      expect(() => parseCircuitsPayload(raw)).not.toThrow();
    }
  });
});

describe("circuitIssueMessage", () => {
  const fields = [...new Set([...GROUP_FIELDS, ...CIRCUIT_FIELDS])];

  it("has non-empty Polish text for every code, scope and field", () => {
    for (const code of CIRCUIT_ISSUE_CODES) {
      const issues: CircuitIssue[] = [
        { scope: "payload", index: null, id: null, field: null, code },
        { scope: "group", index: null, id: null, field: null, code },
        { scope: "circuit", index: null, id: null, field: null, code },
        ...fields.map((field): CircuitIssue => ({ scope: "circuit", index: 2, id: null, field, code })),
        ...fields.map((field): CircuitIssue => ({ scope: "group", index: 0, id: null, field, code })),
      ];
      for (const issue of issues) {
        const message = circuitIssueMessage(issue);
        expect(message.trim()).not.toBe("");
        expect(message).not.toContain("undefined");
      }
    }
  });

  it("names the item by its one-based position and its field", () => {
    const message = circuitIssueMessage({
      scope: "circuit",
      index: 2,
      id: null,
      field: "rated_current_a",
      code: "not_in_list",
    });
    expect(message).toContain("Obwód 3");
    expect(message).toContain("Prąd znamionowy");
  });

  it("states the limit it refers to", () => {
    expect(circuitIssueMessage({ scope: "group", index: 0, id: null, field: "label", code: "too_long" })).toContain(
      String(MAX_GROUP_LABEL_LENGTH),
    );
    expect(circuitIssueMessage({ scope: "circuit", index: null, id: null, field: null, code: "too_many" })).toContain(
      String(MAX_CIRCUITS),
    );
  });
});
