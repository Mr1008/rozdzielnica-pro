import type { UniqueIdentifier } from "@dnd-kit/core";
import type { CircuitDraftState } from "@/lib/circuit-draft";

/**
 * The circuit editor's drag-and-drop ids. dnd-kit keeps one flat id space for every draggable and
 * droppable, so each id carries its kind: a group card (`group:`), a circuit row (`circuit:`) and a
 * container's list (`container:`, the drop target that lets an empty group or "Bez grupy" take a
 * circuit). Row ids are UUIDs, so the ungrouped sentinel can never collide with a group.
 */

const UNGROUPED = "none";

export type DndTarget =
  { kind: "group"; id: string } | { kind: "circuit"; id: string } | { kind: "container"; groupId: string | null };

export function groupDndId(groupId: string): string {
  return `group:${groupId}`;
}

export function circuitDndId(circuitId: string): string {
  return `circuit:${circuitId}`;
}

export function containerDndId(groupId: string | null): string {
  return `container:${groupId ?? UNGROUPED}`;
}

export function parseDndId(raw: UniqueIdentifier): DndTarget | null {
  const value = String(raw);
  const colon = value.indexOf(":");
  if (colon < 0) return null;
  const kind = value.slice(0, colon);
  const rest = value.slice(colon + 1);
  if (kind === "group") return { kind, id: rest };
  if (kind === "circuit") return { kind, id: rest };
  if (kind === "container") return { kind, groupId: rest === UNGROUPED ? null : rest };
  return null;
}

/** A container's circuits, in order. */
export function circuitsIn(draft: CircuitDraftState, groupId: string | null) {
  return draft.circuits.filter((circuit) => circuit.rcd_group_id === groupId);
}

/**
 * Where a circuit dropped on `over` goes, as `moveCircuit` arguments: onto a row, the row's container
 * at the row's index (arrayMove semantics within a container, "insert before" across containers);
 * onto a container's list or its group card, the end of that container.
 */
export function circuitDestination(
  draft: CircuitDraftState,
  over: DndTarget | null,
): { groupId: string | null; index: number } | null {
  if (over === null) return null;
  if (over.kind === "container") return { groupId: over.groupId, index: Number.MAX_SAFE_INTEGER };
  if (over.kind === "group") {
    return draft.groups.some((group) => group.id === over.id)
      ? { groupId: over.id, index: Number.MAX_SAFE_INTEGER }
      : null;
  }
  const target = draft.circuits.find((circuit) => circuit.id === over.id);
  if (!target) return null;
  return { groupId: target.rcd_group_id, index: circuitsIn(draft, target.rcd_group_id).indexOf(target) };
}
