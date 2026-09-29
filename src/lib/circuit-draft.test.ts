import { describe, expect, it } from "vitest";
import {
  EMPTY_CIRCUIT_DRAFT,
  addCircuit,
  addGroup,
  circuitDraftSchema,
  draftToPayload,
  moveCircuit,
  moveCircuitBy,
  moveGroup,
  moveGroupBy,
  nextGroupLabel,
  payloadToDraft,
  removeCircuit,
  removeGroup,
  setCircuitGroup,
  updateCircuit,
  updateGroup,
  type CircuitDraftState,
  type GroupDraft,
} from "./circuit-draft";
import { MAX_GROUPS, parseCircuitsPayload } from "./circuit-params";

/** Deterministic v4-shaped UUIDs, so the parser accepts them. */
function idFactory() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

/** Groups A, B; A holds a1 a2 a3, B holds b1, ungrouped u1 u2. Circuit names equal their tags. */
function fixture(): { draft: CircuitDraftState; id: Record<string, string> } {
  const newId = idFactory();
  let draft = addGroup(addGroup(EMPTY_CIRCUIT_DRAFT, newId), newId);
  const [A, B] = draft.groups.map((group) => group.id);
  const id: Record<string, string> = { A, B };
  for (const [tag, group] of [
    ["a1", A],
    ["a2", A],
    ["b1", B],
    ["u1", null],
    ["a3", A],
    ["u2", null],
  ] as const) {
    draft = addCircuit(draft, group, { newId });
    const created = draft.circuits.find((circuit) => !Object.values(id).includes(circuit.id));
    if (!created) throw new Error("circuit not added");
    id[tag] = created.id;
    draft = updateCircuit(draft, created.id, { name: tag });
  }
  return { draft, id };
}

/** Each container's circuit names, in order: groups by label, then "none". */
function layout(draft: CircuitDraftState): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const group of draft.groups) {
    result[group.label] = draft.circuits.filter((c) => c.rcd_group_id === group.id).map((c) => c.name);
  }
  result.none = draft.circuits.filter((c) => c.rcd_group_id === null).map((c) => c.name);
  return result;
}

const flat = (draft: CircuitDraftState) => draft.circuits.map((circuit) => circuit.name);

describe("nextGroupLabel", () => {
  const group = (label: string): GroupDraft => ({
    id: label,
    label,
    residual_current_ma: 30,
    min_rcd_type: "A",
  });

  it("starts at RCD 1", () => {
    expect(nextGroupLabel([])).toBe("RCD 1");
  });

  it("takes the lowest unused n", () => {
    expect(nextGroupLabel([group("RCD 1"), group("RCD 3")])).toBe("RCD 2");
    expect(nextGroupLabel([group("RCD 2"), group(" RCD 1 "), group("Kuchnia")])).toBe("RCD 3");
  });
});

describe("groups", () => {
  it("adds groups with defaults and the next label", () => {
    const { draft } = fixture();
    expect(draft.groups.map((group) => group.label)).toEqual(["RCD 1", "RCD 2"]);
    expect(draft.groups[0]).toMatchObject({ residual_current_ma: 30, min_rcd_type: "A" });
  });

  it("refuses a group beyond MAX_GROUPS", () => {
    let draft = EMPTY_CIRCUIT_DRAFT;
    const newId = idFactory();
    for (let i = 0; i < MAX_GROUPS + 3; i += 1) draft = addGroup(draft, newId);
    expect(draft.groups).toHaveLength(MAX_GROUPS);
  });

  it("removing a group ungroups its circuits after the existing ungrouped, in order", () => {
    const { draft, id } = fixture();
    const next = removeGroup(draft, id.A);
    expect(layout(next)).toEqual({ "RCD 2": ["b1"], none: ["u1", "u2", "a1", "a2", "a3"] });
    expect(flat(next)).toEqual(["b1", "u1", "u2", "a1", "a2", "a3"]);
  });

  it("reuses a freed label", () => {
    const { draft, id } = fixture();
    expect(addGroup(removeGroup(draft, id.A), idFactory()).groups.map((g) => g.label)).toEqual(["RCD 2", "RCD 1"]);
  });

  it("moves a group and re-orders the flat circuit list with it", () => {
    const { draft, id } = fixture();
    const next = moveGroup(draft, id.B, 0);
    expect(next.groups.map((group) => group.id)).toEqual([id.B, id.A]);
    expect(flat(next)).toEqual(["b1", "a1", "a2", "a3", "u1", "u2"]);
    expect(moveGroup(draft, id.A, 99).groups.map((group) => group.id)).toEqual([id.B, id.A]);
    expect(moveGroup(draft, id.B, -5).groups.map((group) => group.id)).toEqual([id.B, id.A]);
  });

  it("moves a group by a delta", () => {
    const { draft, id } = fixture();
    expect(moveGroupBy(draft, id.A, 1).groups.map((group) => group.id)).toEqual([id.B, id.A]);
    expect(moveGroupBy(draft, id.A, -1)).toBe(draft);
  });

  it("updates a group's fields but never its id", () => {
    const { draft, id } = fixture();
    const next = updateGroup(draft, id.A, { label: "Kuchnia", residual_current_ma: 10 });
    expect(next.groups[0]).toMatchObject({ id: id.A, label: "Kuchnia", residual_current_ma: 10 });
  });
});

describe("circuits", () => {
  it("adds a circuit at the end of its container with defaults", () => {
    const { draft, id } = fixture();
    expect(layout(draft)).toEqual({ "RCD 1": ["a1", "a2", "a3"], "RCD 2": ["b1"], none: ["u1", "u2"] });
    expect(flat(draft)).toEqual(["a1", "a2", "a3", "b1", "u1", "u2"]);
    const newId = () => "new";
    const next = addCircuit(draft, id.B, { newId, entrySide: "bottom" });
    expect(next.circuits.find((c) => c.id === "new")).toEqual({
      id: "new",
      rcd_group_id: id.B,
      name: "Obwód 7",
      rated_current_a: 16,
      phase_count: 1,
      cross_section_mm2: 2.5,
      installation: "conduit_flush",
      entry_side: "bottom",
    });
    expect(flat(next).indexOf("Obwód 7")).toBe(4);
  });

  it("removes a circuit", () => {
    const { draft, id } = fixture();
    expect(flat(removeCircuit(draft, id.a2))).toEqual(["a1", "a3", "b1", "u1", "u2"]);
  });

  it("updates a circuit's fields but never its id or group", () => {
    const { draft, id } = fixture();
    const next = updateCircuit(draft, id.a1, { rated_current_a: 20 });
    expect(next.circuits[0]).toMatchObject({ id: id.a1, rcd_group_id: id.A, rated_current_a: 20 });
  });
});

describe("moveCircuit", () => {
  it("reorders within a container", () => {
    const { draft, id } = fixture();
    expect(layout(moveCircuit(draft, id.a1, id.A, 2))["RCD 1"]).toEqual(["a2", "a3", "a1"]);
    expect(layout(moveCircuit(draft, id.a3, id.A, 0))["RCD 1"]).toEqual(["a3", "a1", "a2"]);
    expect(layout(moveCircuit(draft, id.a1, id.A, 1))["RCD 1"]).toEqual(["a2", "a1", "a3"]);
  });

  it.each([
    [0, ["a2", "a1", "a3"]],
    [1, ["a1", "a2", "a3"]],
    [2, ["a1", "a3", "a2"]],
  ])("moves across containers into index %i (first / middle / last)", (index, expected) => {
    const { draft, id } = fixture();
    const next = moveCircuit(draft, id.a2, null, index);
    expect(layout(next).none).toEqual(["u1", "u2"].toSpliced(index, 0, "a2"));
    const back = moveCircuit(next, id.a2, id.A, index);
    expect(layout(back)["RCD 1"]).toEqual(expected);
  });

  it("moves into a group from another group, keeping the flat order canonical", () => {
    const { draft, id } = fixture();
    const next = moveCircuit(draft, id.u1, id.B, 0);
    expect(layout(next)).toEqual({ "RCD 1": ["a1", "a2", "a3"], "RCD 2": ["u1", "b1"], none: ["u2"] });
    expect(flat(next)).toEqual(["a1", "a2", "a3", "u1", "b1", "u2"]);
  });

  it("moves into an empty container and clamps the index", () => {
    const { draft, id } = fixture();
    const emptied = removeCircuit(draft, id.b1);
    expect(layout(moveCircuit(emptied, id.a1, id.B, 7))["RCD 2"]).toEqual(["a1"]);
    expect(layout(moveCircuit(draft, id.a1, null, -3)).none).toEqual(["a1", "u1", "u2"]);
  });

  it("moves by a delta within the container", () => {
    const { draft, id } = fixture();
    expect(layout(moveCircuitBy(draft, id.a2, -1))["RCD 1"]).toEqual(["a2", "a1", "a3"]);
    expect(layout(moveCircuitBy(draft, id.a3, 1))["RCD 1"]).toEqual(["a1", "a2", "a3"]);
  });

  it("sets a circuit's group, appending it to the end", () => {
    const { draft, id } = fixture();
    expect(layout(setCircuitGroup(draft, id.u1, id.A))["RCD 1"]).toEqual(["a1", "a2", "a3", "u1"]);
    expect(setCircuitGroup(draft, id.a1, id.A)).toBe(draft);
  });
});

describe("invalid ids are no-ops", () => {
  const { draft, id } = fixture();

  it.each([
    ["removeGroup", () => removeGroup(draft, "nope")],
    ["updateGroup", () => updateGroup(draft, "nope", { label: "x" })],
    ["moveGroup", () => moveGroup(draft, "nope", 0)],
    ["moveGroupBy", () => moveGroupBy(draft, "nope", 1)],
    ["addCircuit to unknown group", () => addCircuit(draft, "nope")],
    ["removeCircuit", () => removeCircuit(draft, "nope")],
    ["updateCircuit", () => updateCircuit(draft, "nope", { name: "x" })],
    ["moveCircuit unknown circuit", () => moveCircuit(draft, "nope", null, 0)],
    ["moveCircuit unknown group", () => moveCircuit(draft, id.a1, "nope", 0)],
    ["moveCircuitBy", () => moveCircuitBy(draft, "nope", 1)],
    ["setCircuitGroup unknown group", () => setCircuitGroup(draft, id.a1, "nope")],
  ])("%s", (_name, run) => {
    expect(run()).toBe(draft);
  });
});

describe("payload round trip", () => {
  it("draftToPayload emits a payload the parser accepts, in list order", () => {
    const { draft, id } = fixture();
    const payload = draftToPayload(moveGroup(draft, id.B, 0));
    const parsed = parseCircuitsPayload(JSON.parse(JSON.stringify(payload)));
    expect(parsed.ok).toBe(true);
    expect(payload.groups.map((group) => group.id)).toEqual([id.B, id.A]);
    expect(payload.circuits.map((circuit) => circuit.name)).toEqual(["b1", "a1", "a2", "a3", "u1", "u2"]);
  });

  it("payloadToDraft → draftToPayload is lossless", () => {
    const { draft } = fixture();
    const payload = draftToPayload(draft);
    expect(draftToPayload(payloadToDraft(payload))).toEqual(payload);
  });

  it("payloadToDraft sorts stored rows by position and drops extra columns", () => {
    const { draft } = fixture();
    const payload = draftToPayload(draft);
    const stored = {
      groups: payload.groups.map((group, position) => ({ ...group, position, project_id: "p" })).reverse(),
      circuits: payload.circuits.map((circuit, position) => ({ ...circuit, position, project_id: "p" })).reverse(),
    };
    expect(payloadToDraft(stored)).toEqual(payloadToDraft(payload));
  });

  it("payloadToDraft(null) is the empty draft", () => {
    expect(payloadToDraft(null)).toEqual({ groups: [], circuits: [] });
  });

  it("a draft survives the sessionStorage schema", () => {
    const { draft } = fixture();
    expect(circuitDraftSchema.parse(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    expect(circuitDraftSchema.safeParse({ groups: [], circuits: [{ id: "x" }] }).success).toBe(false);
  });
});
