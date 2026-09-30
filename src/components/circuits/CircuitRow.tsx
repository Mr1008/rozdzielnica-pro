import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChoiceField, type Choice } from "@/components/circuits/ChoiceField";
import { circuitDndId } from "@/components/circuits/circuit-dnd";
import { DragHandle, RowActions } from "@/components/circuits/controls";
import { TextField } from "@/components/forms/fields";
import type { CircuitDraft, CircuitPatch } from "@/lib/circuit-draft";
import {
  CIRCUIT_CROSS_SECTIONS_MM2,
  CIRCUIT_PHASE_COUNTS,
  CIRCUIT_RATED_CURRENTS_A,
  type CircuitField,
  type EntrySide,
} from "@/lib/circuit-params";
import { t } from "@/lib/i18n";
import { WLZ_INSTALLATIONS } from "@/lib/supply-params";
import { cn } from "@/lib/utils";

const e = t.circuits.editor;

const RATED_CURRENT_CHOICES = CIRCUIT_RATED_CURRENTS_A.map((value) => ({
  value,
  label: e.ratedCurrentOption(value),
}));
const PHASE_CHOICES = CIRCUIT_PHASE_COUNTS.map((value) => ({ value, label: t.supply.phaseCountOption(value) }));
const CROSS_SECTION_CHOICES = CIRCUIT_CROSS_SECTIONS_MM2.map((value) => ({
  value,
  label: t.supply.crossSectionOption(value),
}));
const INSTALLATION_CHOICES = WLZ_INSTALLATIONS.map((value) => ({ value, label: t.supply.installations[value] }));

/** "16 A · 1 faza · 2,5 mm²" — the drag overlay's one-line summary of a row. */
export function circuitSummary(circuit: CircuitDraft): string {
  return [
    e.ratedCurrentOption(circuit.rated_current_a),
    t.supply.phaseCountOption(circuit.phase_count),
    t.supply.crossSectionOption(circuit.cross_section_mm2),
  ].join(" · ");
}

export interface CircuitRowProps {
  circuit: CircuitDraft;
  /** The name to announce and label controls with — the typed name, or "Obwód n" while it is empty. */
  displayName: string;
  groupChoices: readonly Choice<string | null>[];
  entrySideChoices: readonly Choice<EntrySide>[];
  /** The visible issue on one of the row's fields, if any. */
  issueFor: (field: CircuitField) => string | undefined;
  /** A group is being dragged: rows must not act as drop targets. */
  dropDisabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (patch: CircuitPatch) => void;
  onNameBlur: () => void;
  onGroupChange: (groupId: string | null) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}

export function CircuitRow({
  circuit,
  displayName,
  groupChoices,
  entrySideChoices,
  issueFor,
  dropDisabled,
  canMoveUp,
  canMoveDown,
  onChange,
  onNameBlur,
  onGroupChange,
  onMove,
  onRemove,
}: CircuitRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: circuitDndId(circuit.id),
    disabled: { draggable: false, droppable: dropDisabled },
  });
  const f = e.circuitFields;
  const id = `circuit-${circuit.id}`;
  const nameIssue = issueFor("name");
  const invalid =
    nameIssue !== undefined ||
    (["rated_current_a", "phase_count", "cross_section_mm2", "installation", "entry_side", "rcd_group_id"] as const)
      .map(issueFor)
      .some((issue) => issue !== undefined);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={e.circuitRow(displayName)}
      className={cn(
        "bg-background flex items-start gap-2 rounded-md border p-3",
        invalid ? "border-destructive/60" : "border-border",
        isDragging && "opacity-40",
      )}
    >
      <DragHandle
        label={e.dragCircuit(displayName)}
        attributes={attributes}
        listeners={listeners}
        setActivatorNodeRef={setActivatorNodeRef}
        className="mt-6"
      />
      <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="sm:col-span-2">
          <TextField
            id={`${id}-name`}
            label={f.name}
            value={circuit.name}
            onChange={(name) => {
              onChange({ name });
            }}
            onBlur={onNameBlur}
            error={nameIssue}
          />
        </div>
        <ChoiceField
          id={`${id}-group`}
          label={f.group}
          value={circuit.rcd_group_id}
          choices={groupChoices}
          onChange={onGroupChange}
          error={issueFor("rcd_group_id")}
        />
        <ChoiceField
          id={`${id}-rated-current`}
          label={f.ratedCurrent}
          value={circuit.rated_current_a}
          choices={RATED_CURRENT_CHOICES}
          onChange={(rated_current_a) => {
            onChange({ rated_current_a });
          }}
          error={issueFor("rated_current_a")}
        />
        <ChoiceField
          id={`${id}-phases`}
          label={f.phaseCount}
          value={circuit.phase_count}
          choices={PHASE_CHOICES}
          onChange={(phase_count) => {
            onChange({ phase_count });
          }}
          error={issueFor("phase_count")}
        />
        <ChoiceField
          id={`${id}-cross-section`}
          label={f.crossSection}
          value={circuit.cross_section_mm2}
          choices={CROSS_SECTION_CHOICES}
          onChange={(cross_section_mm2) => {
            onChange({ cross_section_mm2 });
          }}
          error={issueFor("cross_section_mm2")}
        />
        <ChoiceField
          id={`${id}-installation`}
          label={f.installation}
          value={circuit.installation}
          choices={INSTALLATION_CHOICES}
          onChange={(installation) => {
            onChange({ installation });
          }}
          error={issueFor("installation")}
        />
        <ChoiceField
          id={`${id}-entry-side`}
          label={f.entrySide}
          value={circuit.entry_side}
          choices={entrySideChoices}
          onChange={(entry_side) => {
            onChange({ entry_side });
          }}
          error={issueFor("entry_side")}
        />
      </div>
      <RowActions
        subject={e.circuitRow(displayName)}
        removeLabel={e.removeCircuit(displayName)}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onMoveUp={() => {
          onMove(-1);
        }}
        onMoveDown={() => {
          onMove(1);
        }}
        onRemove={onRemove}
        className="mt-6"
      />
    </li>
  );
}
