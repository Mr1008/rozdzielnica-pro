import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { circuitDndId, containerDndId } from "@/components/circuits/circuit-dnd";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface CircuitContainerProps {
  /** `null` is "Bez grupy". */
  groupId: string | null;
  circuitIds: readonly string[];
  /** A group is being dragged: the list must not act as a drop target. */
  dropDisabled: boolean;
  children: ReactNode;
}

/**
 * One container's circuit list: its own `SortableContext` for reordering, and a droppable of its
 * own, so an empty group or an empty "Bez grupy" still accepts a dragged circuit.
 */
export function CircuitContainer({ groupId, circuitIds, dropDisabled, children }: CircuitContainerProps) {
  const { setNodeRef, isOver } = useDroppable({ id: containerDndId(groupId), disabled: dropDisabled });
  const items = circuitIds.map(circuitDndId);
  return (
    <SortableContext id={containerDndId(groupId)} items={items} strategy={verticalListSortingStrategy}>
      <ol
        ref={setNodeRef}
        className={cn(
          "flex min-h-14 flex-col gap-2 rounded-md border border-dashed p-2 transition-colors",
          isOver ? "border-primary bg-accent/40" : "border-transparent",
          circuitIds.length === 0 && !isOver && "border-border",
        )}
      >
        {children}
        {circuitIds.length === 0 && (
          <li className="text-muted-foreground flex min-h-10 items-center justify-center text-center text-xs">
            {t.circuits.editor.emptyContainer}
          </li>
        )}
      </ol>
    </SortableContext>
  );
}
