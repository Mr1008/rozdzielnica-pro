import { useEffect, useMemo, useRef, useState, type JSX, type SubmitEvent } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CircleAlert, GripVertical, Plus, Save } from "lucide-react";
import { CircuitContainer } from "@/components/circuits/CircuitContainer";
import { CircuitRow, circuitSummary } from "@/components/circuits/CircuitRow";
import type { Choice } from "@/components/circuits/ChoiceField";
import { GroupCard } from "@/components/circuits/GroupCard";
import {
  circuitDestination,
  circuitDndId,
  circuitsIn,
  groupDndId,
  parseDndId,
  type DndTarget,
} from "@/components/circuits/circuit-dnd";
import { clearStoredDraft, readStoredDraft, writeStoredDraft } from "@/components/forms/draft-storage";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ENTRY_SIDES } from "@/lib/cabinet-geometry";
import {
  addCircuit,
  addGroup,
  circuitDraftSchema,
  draftToPayload,
  moveCircuit,
  moveCircuitBy,
  moveGroup,
  moveGroupBy,
  removeCircuit,
  removeGroup,
  setCircuitGroup,
  updateCircuit,
  updateGroup,
  type CircuitDraftState,
} from "@/lib/circuit-draft";
import {
  CIRCUIT_FORM_FIELDS,
  MAX_CIRCUITS,
  MAX_GROUPS,
  circuitIssueMessage,
  parseCircuitsPayload,
  type CircuitField,
  type CircuitIssue,
  type EntrySide,
} from "@/lib/circuit-params";
import { t } from "@/lib/i18n";

export interface CircuitEditorProps {
  /** The endpoint the native form posts to (`projectCircuitsApiPath(id)`). */
  action: string;
  /** The saved circuits and groups, from `payloadToDraft`. */
  initial: CircuitDraftState;
  /** The entry sides the project's cabinet snapshot actually has. */
  cabinetEntrySides: readonly EntrySide[];
  /** The `sessionStorage` key of this project's draft. */
  draftKey: string;
  /** The page came back from a rejection (`?error=`): restore the draft stored on submit. */
  restoreDraft: boolean;
  /** Show every field issue from the first render instead of after blur or a submit attempt. */
  validateOnMount?: boolean;
}

const e = t.circuits.editor;
const dnd = t.circuits.dnd;

type IssueKey = `${"group" | "circuit"}:${string}:${CircuitField}`;

function issueKey(scope: "group" | "circuit", id: string, field: CircuitField): IssueKey {
  return `${scope}:${id}:${field}`;
}

/** The first issue per row field, and the issues that belong to no row field (list limits, payload). */
function indexIssues(draft: CircuitDraftState, issues: readonly CircuitIssue[]) {
  const ids = new Set([...draft.groups.map((group) => group.id), ...draft.circuits.map((circuit) => circuit.id)]);
  const byField = new Map<IssueKey, string>();
  const general: string[] = [];
  for (const issue of issues) {
    if (issue.scope !== "payload" && issue.id !== null && issue.field !== null && ids.has(issue.id)) {
      const key = issueKey(issue.scope, issue.id, issue.field);
      if (!byField.has(key)) byField.set(key, circuitIssueMessage(issue));
    } else {
      general.push(circuitIssueMessage(issue));
    }
  }
  return { byField, general };
}

function groupName(draft: CircuitDraftState, groupId: string): string {
  const index = draft.groups.findIndex((group) => group.id === groupId);
  if (index < 0) return "";
  return draft.groups[index].label.trim() || t.circuitIssues.groupNumbered(index + 1);
}

function circuitName(draft: CircuitDraftState, circuitId: string): string {
  const index = draft.circuits.findIndex((circuit) => circuit.id === circuitId);
  if (index < 0) return "";
  return draft.circuits[index].name.trim() || t.circuitIssues.circuitNumbered(index + 1);
}

function containerName(draft: CircuitDraftState, groupId: string | null): string {
  return groupId === null ? dnd.ungroupedContainer : dnd.groupContainer(groupName(draft, groupId));
}

function subjectOf(draft: CircuitDraftState, target: DndTarget | null): string {
  if (target?.kind === "group") return dnd.groupSubject(groupName(draft, target.id));
  if (target?.kind === "circuit") return dnd.circuitSubject(circuitName(draft, target.id));
  return "";
}

/** Where the dragged item would land over `over`, for the screen-reader announcements. */
function placeOf(
  draft: CircuitDraftState,
  active: DndTarget | null,
  over: DndTarget | null,
): { position: number; total: number; container: string } | null {
  if (active === null || over === null) return null;
  if (active.kind === "group") {
    if (over.kind !== "group") return null;
    const index = draft.groups.findIndex((group) => group.id === over.id);
    return index < 0 ? null : { position: index + 1, total: draft.groups.length, container: dnd.groupList };
  }
  if (active.kind !== "circuit") return null;
  const destination = circuitDestination(draft, over);
  if (destination === null) return null;
  const list = circuitsIn(draft, destination.groupId);
  const inside = list.some((circuit) => circuit.id === active.id);
  const total = list.length + (inside ? 0 : 1);
  const position = Math.min(destination.index, total - 1) + 1;
  return { position, total, container: containerName(draft, destination.groupId) };
}

/**
 * `closestCorners`, except that a hit on a container's list that has rows is refined to the closest
 * row inside it — the dnd-kit multi-container pattern, so a circuit dropped over a filled list lands
 * next to a row rather than always at the end.
 */
function collisionDetectionFor(draft: CircuitDraftState): CollisionDetection {
  return (args) => {
    const hits = closestCorners(args);
    const first = hits.at(0);
    const target = first ? parseDndId(first.id) : null;
    if (target?.kind !== "container") return hits;
    const rowIds = new Set<UniqueIdentifier>(circuitsIn(draft, target.groupId).map((c) => circuitDndId(c.id)));
    const rows = args.droppableContainers.filter((container) => rowIds.has(container.id));
    return rows.length > 0 ? closestCorners({ ...args, droppableContainers: rows }) : hits;
  };
}

/**
 * The circuits and RCD groups of one project (FR-006); mount it `client:only="react"` (the draft
 * restore below reads `sessionStorage` on the first render). Every change goes through the pure
 * operations of `@/lib/circuit-draft`; drag and drop (pointer and keyboard) and the per-row buttons
 * and "Grupa" select are two ways of calling the same ones. A native `<form method="POST">` carries
 * one hidden JSON field, which `parseCircuitsPayload` judges here exactly as the endpoint does.
 */
export default function CircuitEditor({
  action,
  initial,
  cabinetEntrySides,
  draftKey,
  restoreDraft,
  validateOnMount = false,
}: CircuitEditorProps): JSX.Element {
  const [boot] = useState(() => {
    const stored = restoreDraft ? readStoredDraft(draftKey, circuitDraftSchema) : null;
    return { draft: stored ?? initial, restored: stored !== null };
  });
  const [draft, setDraft] = useState<CircuitDraftState>(boot.draft);
  const [showAll, setShowAll] = useState(validateOnMount || boot.restored);
  const [touched, setTouched] = useState<ReadonlySet<IssueKey>>(() => new Set());
  const [active, setActive] = useState<DndTarget | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The draft at drag start, restored when the drag is cancelled (Escape): `onDragOver` has already
  // moved a circuit across containers by then.
  const beforeDrag = useRef<CircuitDraftState | null>(null);

  // Any visit that is not the return from a rejection discards the stored draft.
  useEffect(() => {
    if (!restoreDraft) clearStoredDraft(draftKey);
  }, [restoreDraft, draftKey]);

  // Back-navigation can restore this page from the bfcache mid-submit; re-enable the button.
  useEffect(() => {
    const onPageShow = () => {
      setSubmitting(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const payload = draftToPayload(draft);
  const parsed = parseCircuitsPayload(payload);
  const { byField, general } = indexIssues(draft, parsed.ok ? [] : parsed.issues);

  const issueFor = (scope: "group" | "circuit", id: string) => (field: CircuitField) => {
    const key = issueKey(scope, id, field);
    return showAll || touched.has(key) ? byField.get(key) : undefined;
  };
  const touch = (scope: "group" | "circuit", id: string, field: CircuitField) => {
    setTouched((previous) => new Set(previous).add(issueKey(scope, id, field)));
  };

  const presentSides = ENTRY_SIDES.filter((side) => cabinetEntrySides.includes(side));
  const entrySideChoices = useMemo<Choice<EntrySide>[]>(
    () => [
      ...ENTRY_SIDES.filter((side) => cabinetEntrySides.includes(side)).map((side) => ({
        value: side,
        label: t.cabinets.sides[side],
      })),
      ...ENTRY_SIDES.filter((side) => !cabinetEntrySides.includes(side)).map((side) => ({
        value: side,
        label: e.entrySideMissing(t.cabinets.sides[side]),
      })),
    ],
    [cabinetEntrySides],
  );
  const groupChoices: Choice<string | null>[] = [
    ...draft.groups.map((group) => ({ value: group.id, label: groupName(draft, group.id) })),
    { value: null, label: e.ungrouped },
  ];

  const canAddGroup = draft.groups.length < MAX_GROUPS;
  const canAddCircuit = draft.circuits.length < MAX_CIRCUITS;
  const newCircuitSide: EntrySide = presentSides.at(0) ?? "top";
  const isEmpty = draft.groups.length === 0 && draft.circuits.length === 0;

  function handleAddCircuit(groupId: string | null) {
    setDraft((previous) => addCircuit(previous, groupId, { entrySide: newCircuitSide }));
  }

  // ---- Drag and drop ----------------------------------------------------------------------------

  function handleDragStart({ active: dragged }: DragStartEvent) {
    beforeDrag.current = draft;
    setActive(parseDndId(dragged.id));
  }

  function handleDragOver({ active: dragged, over }: DragOverEvent) {
    const target = parseDndId(dragged.id);
    if (target?.kind !== "circuit" || !over) return;
    // Across containers the row moves while dragging, so the target list opens a gap for it.
    setDraft((previous) => {
      const circuit = previous.circuits.find((candidate) => candidate.id === target.id);
      const destination = circuitDestination(previous, parseDndId(over.id));
      if (!circuit || !destination || destination.groupId === circuit.rcd_group_id) return previous;
      return moveCircuit(previous, target.id, destination.groupId, destination.index);
    });
  }

  function handleDragEnd({ active: dragged, over }: DragEndEvent) {
    const target = parseDndId(dragged.id);
    beforeDrag.current = null;
    setActive(null);
    if (!target || !over) return;
    const overTarget = parseDndId(over.id);
    if (target.kind === "group") {
      if (overTarget?.kind !== "group") return;
      setDraft((previous) =>
        moveGroup(
          previous,
          target.id,
          previous.groups.findIndex((group) => group.id === overTarget.id),
        ),
      );
    } else if (target.kind === "circuit") {
      setDraft((previous) => {
        const destination = circuitDestination(previous, overTarget);
        return destination ? moveCircuit(previous, target.id, destination.groupId, destination.index) : previous;
      });
    }
  }

  function handleDragCancel() {
    const snapshot = beforeDrag.current;
    beforeDrag.current = null;
    setActive(null);
    if (snapshot) setDraft(snapshot);
  }

  const announcements: Announcements = {
    onDragStart: ({ active: dragged }) => dnd.pickedUp(subjectOf(draft, parseDndId(dragged.id))),
    onDragOver: ({ active: dragged, over }) => {
      const target = parseDndId(dragged.id);
      const place = placeOf(draft, target, over ? parseDndId(over.id) : null);
      return place ? dnd.movedOver(subjectOf(draft, target), place.position, place.total, place.container) : undefined;
    },
    onDragEnd: ({ active: dragged, over }) => {
      const target = parseDndId(dragged.id);
      const place = placeOf(draft, target, over ? parseDndId(over.id) : null);
      return place
        ? dnd.dropped(subjectOf(draft, target), place.position, place.total, place.container)
        : dnd.droppedNowhere(subjectOf(draft, target));
    },
    onDragCancel: ({ active: dragged }) =>
      dnd.cancelled(subjectOf(beforeDrag.current ?? draft, parseDndId(dragged.id))),
  };

  // ---- Submit -----------------------------------------------------------------------------------

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    if (!parsed.ok || submitting) {
      event.preventDefault();
      setShowAll(true);
      return;
    }
    writeStoredDraft(draftKey, draft);
    setSubmitting(true);
  }

  // ---- Rendering --------------------------------------------------------------------------------

  const draggingGroup = active?.kind === "group";
  const draggingCircuit = active?.kind === "circuit";

  function renderRows(groupId: string | null) {
    const list = circuitsIn(draft, groupId);
    return list.map((circuit, index) => (
      <CircuitRow
        key={circuit.id}
        circuit={circuit}
        displayName={circuitName(draft, circuit.id)}
        groupChoices={groupChoices}
        entrySideChoices={entrySideChoices}
        issueFor={issueFor("circuit", circuit.id)}
        dropDisabled={draggingGroup}
        canMoveUp={index > 0}
        canMoveDown={index < list.length - 1}
        onChange={(patch) => {
          setDraft((previous) => updateCircuit(previous, circuit.id, patch));
        }}
        onNameBlur={() => {
          touch("circuit", circuit.id, "name");
        }}
        onGroupChange={(nextGroupId) => {
          setDraft((previous) => setCircuitGroup(previous, circuit.id, nextGroupId));
        }}
        onMove={(delta) => {
          setDraft((previous) => moveCircuitBy(previous, circuit.id, delta));
        }}
        onRemove={() => {
          setDraft((previous) => removeCircuit(previous, circuit.id));
        }}
      />
    ));
  }

  function renderOverlay() {
    if (active?.kind === "circuit") {
      const circuit = draft.circuits.find((candidate) => candidate.id === active.id);
      if (!circuit) return null;
      return (
        <div className="bg-background border-primary ring-primary flex items-center gap-2 rounded-md border p-3 shadow-lg ring-1">
          <GripVertical className="text-muted-foreground size-4" aria-hidden="true" />
          <span className="font-medium">{circuitName(draft, circuit.id)}</span>
          <span className="text-muted-foreground font-mono text-xs tabular-nums">{circuitSummary(circuit)}</span>
        </div>
      );
    }
    if (active?.kind === "group") {
      return (
        <div className="bg-card border-primary ring-primary flex items-center gap-2 rounded-lg border p-3 shadow-lg ring-1">
          <GripVertical className="text-muted-foreground size-4" aria-hidden="true" />
          <span className="font-semibold">{groupName(draft, active.id)}</span>
          <span className="text-muted-foreground text-xs">{e.circuitCount(circuitsIn(draft, active.id).length)}</span>
        </div>
      );
    }
    return null;
  }

  const blocked = showAll && !parsed.ok;

  return (
    <form method="POST" action={action} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name={CIRCUIT_FORM_FIELDS.payload} value={JSON.stringify(payload)} />

      <p className="text-muted-foreground text-sm">{e.hint}</p>

      {isEmpty ? (
        <p className="text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-sm">{e.empty}</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetectionFor(draft)}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          accessibility={{ announcements, screenReaderInstructions: { draggable: dnd.instructions } }}
        >
          <div className="flex flex-col gap-4" role="group" aria-label={e.label}>
            <SortableContext
              items={draft.groups.map((group) => groupDndId(group.id))}
              strategy={verticalListSortingStrategy}
            >
              {draft.groups.length > 0 && (
                <ol className="flex flex-col gap-3">
                  {draft.groups.map((group, index) => (
                    <GroupCard
                      key={group.id}
                      group={group}
                      displayName={groupName(draft, group.id)}
                      circuitCount={circuitsIn(draft, group.id).length}
                      issueFor={issueFor("group", group.id)}
                      dropDisabled={draggingCircuit}
                      canMoveUp={index > 0}
                      canMoveDown={index < draft.groups.length - 1}
                      canAddCircuit={canAddCircuit}
                      onChange={(patch) => {
                        setDraft((previous) => updateGroup(previous, group.id, patch));
                      }}
                      onLabelBlur={() => {
                        touch("group", group.id, "label");
                      }}
                      onMove={(delta) => {
                        setDraft((previous) => moveGroupBy(previous, group.id, delta));
                      }}
                      onRemove={() => {
                        setDraft((previous) => removeGroup(previous, group.id));
                      }}
                      onAddCircuit={() => {
                        handleAddCircuit(group.id);
                      }}
                    >
                      <CircuitContainer
                        groupId={group.id}
                        circuitIds={circuitsIn(draft, group.id).map((circuit) => circuit.id)}
                        dropDisabled={draggingGroup}
                      >
                        {renderRows(group.id)}
                      </CircuitContainer>
                    </GroupCard>
                  ))}
                </ol>
              )}
            </SortableContext>

            <section
              aria-label={e.ungrouped}
              className="bg-muted/40 flex flex-col gap-3 rounded-lg border border-dashed p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{e.ungrouped}</h3>
                <p className="text-muted-foreground text-xs">{e.ungroupedHint}</p>
              </div>
              <CircuitContainer
                groupId={null}
                circuitIds={circuitsIn(draft, null).map((circuit) => circuit.id)}
                dropDisabled={draggingGroup}
              >
                {renderRows(null)}
              </CircuitContainer>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  handleAddCircuit(null);
                }}
                disabled={!canAddCircuit}
                aria-label={e.addCircuitTo(e.ungrouped)}
                className="self-start"
              >
                <Plus aria-hidden="true" />
                {e.addCircuit}
              </Button>
            </section>
          </div>
          <DragOverlay>{renderOverlay()}</DragOverlay>
        </DndContext>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setDraft((previous) => addGroup(previous));
          }}
          disabled={!canAddGroup}
        >
          <Plus aria-hidden="true" />
          {e.addGroup}
        </Button>
        {isEmpty && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              handleAddCircuit(null);
            }}
            aria-label={e.addCircuitTo(e.ungrouped)}
          >
            <Plus aria-hidden="true" />
            {e.addCircuit}
          </Button>
        )}
        {!canAddGroup && <p className="text-muted-foreground text-xs">{e.maxGroups(MAX_GROUPS)}</p>}
        {!canAddCircuit && <p className="text-muted-foreground text-xs">{e.maxCircuits(MAX_CIRCUITS)}</p>}
      </div>

      {showAll && general.length > 0 && (
        <ul className="flex flex-col gap-1">
          {general.map((message) => (
            <li key={message} className="text-destructive flex items-start gap-1 text-xs">
              <CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              {message}
            </li>
          ))}
        </ul>
      )}

      {blocked && (
        <Alert variant="warning" role="status">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{e.blocked}</AlertDescription>
        </Alert>
      )}

      <div>
        <Button type="submit" pending={submitting}>
          {!submitting && <Save aria-hidden="true" />}
          {submitting ? e.saving : t.circuitSection.save}
        </Button>
      </div>
    </form>
  );
}
