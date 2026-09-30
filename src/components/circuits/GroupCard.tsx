import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Info, Plus } from "lucide-react";
import { ChoiceField } from "@/components/circuits/ChoiceField";
import { groupDndId } from "@/components/circuits/circuit-dnd";
import { DragHandle, RowActions } from "@/components/circuits/controls";
import { TextField } from "@/components/forms/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GroupDraft, GroupPatch } from "@/lib/circuit-draft";
import { RESIDUAL_CURRENTS_MA, type CircuitField } from "@/lib/circuit-params";
import { RCD_TYPES } from "@/lib/device-spec";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const e = t.circuits.editor;

const RESIDUAL_CURRENT_CHOICES = RESIDUAL_CURRENTS_MA.map((value) => ({
  value,
  label: e.residualCurrentOption(value),
}));
const RCD_TYPE_CHOICES = RCD_TYPES.map((value) => ({ value, label: t.devices.rcdTypes[value] }));

export interface GroupCardProps {
  group: GroupDraft;
  /** The typed label, or "Grupa RCD n" while it is empty. */
  displayName: string;
  circuitCount: number;
  issueFor: (field: CircuitField) => string | undefined;
  /** A circuit is being dragged: the card must not act as a drop target (its list does). */
  dropDisabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canAddCircuit: boolean;
  onChange: (patch: GroupPatch) => void;
  onLabelBlur: () => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onAddCircuit: () => void;
  /** The group's `CircuitContainer`. */
  children: ReactNode;
}

export function GroupCard({
  group,
  displayName,
  circuitCount,
  issueFor,
  dropDisabled,
  canMoveUp,
  canMoveDown,
  canAddCircuit,
  onChange,
  onLabelBlur,
  onMove,
  onRemove,
  onAddCircuit,
  children,
}: GroupCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: groupDndId(group.id),
    disabled: { draggable: false, droppable: dropDisabled },
  });
  const f = e.groupFields;
  const id = `group-${group.id}`;
  const labelIssue = issueFor("label");
  const invalid = labelIssue !== undefined || issueFor("residual_current_ma") !== undefined;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={e.groupCard(displayName)}
      className={cn(
        "bg-card flex flex-col gap-3 rounded-lg border p-3",
        invalid ? "border-destructive/60" : "border-border",
        isDragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        <DragHandle
          label={e.dragGroup(displayName)}
          attributes={attributes}
          listeners={listeners}
          setActivatorNodeRef={setActivatorNodeRef}
          className="mt-6"
        />
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3">
          <TextField
            id={`${id}-label`}
            label={f.label}
            value={group.label}
            onChange={(label) => {
              onChange({ label });
            }}
            onBlur={onLabelBlur}
            error={labelIssue}
          />
          <ChoiceField
            id={`${id}-residual-current`}
            label={f.residualCurrent}
            value={group.residual_current_ma}
            choices={RESIDUAL_CURRENT_CHOICES}
            onChange={(residual_current_ma) => {
              onChange({ residual_current_ma });
            }}
            error={issueFor("residual_current_ma")}
          />
          <ChoiceField
            id={`${id}-min-rcd-type`}
            label={f.minRcdType}
            value={group.min_rcd_type}
            choices={RCD_TYPE_CHOICES}
            onChange={(min_rcd_type) => {
              onChange({ min_rcd_type });
            }}
            error={issueFor("min_rcd_type")}
          />
        </div>
        <RowActions
          subject={e.groupCard(displayName)}
          removeLabel={e.removeGroup(displayName)}
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
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-10">
        <Badge variant="outline" className="font-mono tabular-nums">
          {e.circuitCount(circuitCount)}
        </Badge>
        {circuitCount === 1 && (
          <p className="text-info flex items-center gap-1 text-xs">
            <Info className="size-3" aria-hidden="true" />
            {e.rcboHint}
          </p>
        )}
      </div>

      {children}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAddCircuit}
        disabled={!canAddCircuit}
        aria-label={e.addCircuitTo(e.groupCard(displayName))}
        className="self-start"
      >
        <Plus aria-hidden="true" />
        {e.addCircuit}
      </Button>
    </li>
  );
}
