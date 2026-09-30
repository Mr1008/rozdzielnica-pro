import type { ComponentProps, ReactNode } from "react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The circuit editor's small controls: the drag handle (the only element that starts a drag, by
 * pointer or keyboard) and the icon buttons that are its non-drag equivalents.
 */

export interface DragHandleProps {
  label: string;
  attributes?: DraggableAttributes;
  listeners?: DraggableSyntheticListeners;
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
  className?: string;
}

export function DragHandle({ label, attributes, listeners, setActivatorNodeRef, className }: DragHandleProps) {
  return (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={label}
      title={label}
      className={cn(
        "text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md active:cursor-grabbing",
        className,
      )}
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
}

function IconButton({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & Omit<ComponentProps<typeof Button>, "children">) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} {...props}>
      {children}
    </Button>
  );
}

export interface RowActionsProps {
  subject: string;
  removeLabel: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  className?: string;
}

/** Move up, move down and remove, for a group card or a circuit row. */
export function RowActions({
  subject,
  removeLabel,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
  className,
}: RowActionsProps) {
  const e = t.circuits.editor;
  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", className)}>
      <IconButton label={e.moveUp(subject)} disabled={!canMoveUp} onClick={onMoveUp}>
        <ArrowUp aria-hidden="true" />
      </IconButton>
      <IconButton label={e.moveDown(subject)} disabled={!canMoveDown} onClick={onMoveDown}>
        <ArrowDown aria-hidden="true" />
      </IconButton>
      <IconButton label={removeLabel} onClick={onRemove} className="hover:text-destructive">
        <Trash2 aria-hidden="true" />
      </IconButton>
    </div>
  );
}
