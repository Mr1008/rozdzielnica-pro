import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SubmitEvent,
  type SVGProps,
} from "react";
import { Redo2, Save, TriangleAlertIcon, Undo2, WandSparkles } from "lucide-react";
import { z } from "zod";
import { CabinetDrawing, type DrawingInteraction } from "@/components/cabinets/CabinetDrawing";
import { clearStoredDraft, readStoredDraft, writeStoredDraft } from "@/components/forms/draft-storage";
import { LayoutLegend } from "@/components/projects/LayoutLegend";
import { useWiringDrawing } from "@/components/projects/WiringDrawing";
import { WireLengthsTable } from "@/components/projects/WireLengthsTable";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildDrawnDevices, type DrawnDevice, type WiringVariant } from "@/lib/cabinet-drawing";
import { RAIL_HEIGHT_MM, type CabinetGeometry } from "@/lib/cabinet-geometry";
import {
  layoutIssueMessage,
  validateLayout,
  type LayoutGroup,
  type LayoutIssue,
  type LayoutIssueNames,
  type Placement,
} from "@/lib/cabinet-layout";
import { wiringWarningMessage } from "@/lib/cabinet-wiring";
import { DIN_MODULE_MM } from "@/lib/din-module";
import { formatNumber, t } from "@/lib/i18n";
import type { EditorDevice } from "@/lib/layout-editor-data";
import {
  LAYOUT_FORM_FIELDS,
  editUnits,
  history,
  keyboardStep,
  moveUnit,
  parsePlacementsPayload,
  previewMove,
  snapX,
  type EditContext,
  type EditUnit,
  type History,
  type LayoutDraft,
  type MoveTarget,
  type StepDirection,
} from "@/lib/layout-editing";
import { cn } from "@/lib/utils";
import type { WiringData } from "@/lib/wiring-island";

export interface LayoutEditorProps {
  geometry: CabinetGeometry;
  /** The `current` snapshot's devices — what the drawing and the moves are built from. */
  devices: EditorDevice[];
  groups: Pick<LayoutGroup, "id" | "label">[];
  /** The saved placements. */
  placements: Placement[];
  /** The saved layout carries the electrician's own corrections. */
  editedManually: boolean;
  /** Device and group names for the refusal messages. */
  names: LayoutIssueNames;
  /**
   * The router's input for the saved layout. Its wires, overflow warning and lengths are routed here in
   * the browser (S-11 Phase 5) and shown only while the draft equals the saved layout.
   */
  wiring: WiringData | null;
  /** The look of the saved layout's wires (the page's "Widok" switch). Default realistic. */
  wiringVariant?: WiringVariant;
  slackPercent: number;
  /** The endpoint a manual save posts to (`projectPlacementsApiPath(id)`). */
  saveAction: string;
  /** The endpoint "Zaproponuj układ od nowa" posts to (`projectLayoutApiPath(id)`). */
  reproposeAction: string;
  /** The `sessionStorage` key of this project's draft. */
  draftKey: string;
  /** The page came back from a rejection (`?error=`): restore the draft stored on submit. */
  restoreDraft: boolean;
  /** A draft to start from instead of the saved layout — the kitchen sink's unsaved state. */
  initialDraft?: Placement[];
}

const e = t.layout.editor;

/** A pointer drag in progress: where the unit was grabbed, where it started and where it would land now. */
interface PointerDrag {
  unit: EditUnit;
  /** From the pointer to the unit's first device: its left edge, and its vertical centre. */
  grabDx: number;
  grabDy: number;
  /** The unit's total width, for the snap. */
  width: number;
  origin: MoveTarget;
  target: MoveTarget;
}

/** The window listeners of a pointer drag, attached on pointerdown and removed when it ends. */
interface DragHandlers {
  move: (event: PointerEvent) => void;
  up: () => void;
  cancel: () => void;
  key: (event: KeyboardEvent) => void;
}

interface KeyboardLift {
  unit: EditUnit;
  target: MoveTarget;
  /** The last drop was refused: the unit stays picked up, outlined as an error. */
  refused: boolean;
}

const draftSchema = z.object({
  placements: z.array(z.object({ projectDeviceId: z.string(), railIndex: z.number(), xMm: z.number() })),
});

const EPS = 1e-6;
/** Appended to a repeated announcement so the live region reads it again. */
const NBSP = String.fromCharCode(160);

function unitDeviceIds(unit: EditUnit): string[] {
  return unit.kind === "block" ? unit.deviceIds : [unit.deviceId];
}

function sameUnit(a: EditUnit, b: EditUnit): boolean {
  return a.kind === "block"
    ? b.kind === "block" && a.groupId === b.groupId
    : b.kind === "device" && a.deviceId === b.deviceId;
}

function samePlacements(a: LayoutDraft, b: LayoutDraft): boolean {
  if (a.placements.length !== b.placements.length) return false;
  const byId = new Map(b.placements.map((placement) => [placement.projectDeviceId, placement]));
  return a.placements.every((placement) => {
    const other = byId.get(placement.projectDeviceId);
    return other?.railIndex === placement.railIndex && Math.abs(other.xMm - placement.xMm) < EPS;
  });
}

/** Placements in snapshot order, the order every move keeps. */
function normalised(placements: readonly Placement[], devices: readonly EditorDevice[]): LayoutDraft {
  const position = new Map(devices.map((device) => [device.id, device.position]));
  return {
    placements: [...placements].sort(
      (a, b) => (position.get(a.projectDeviceId) ?? 0) - (position.get(b.projectDeviceId) ?? 0),
    ),
  };
}

/** The unit's devices as drawn, in rail then x order — the first is the one a move is measured from. */
function drawnMembers(drawn: ReadonlyMap<string, DrawnDevice>, unit: EditUnit): DrawnDevice[] {
  return unitDeviceIds(unit)
    .flatMap((id) => drawn.get(id) ?? [])
    .sort((a, b) => a.railIndex - b.railIndex || a.rect.x - b.rect.x);
}

/**
 * The layout of one project, editable (FR-009, S-06); mount it `client:only="react"` (the draft restore
 * reads `sessionStorage` on the first render). Every change goes through the pure operations of
 * `@/lib/layout-editing`: the pointer drag and the keyboard lift are two ways of calling `moveUnit`,
 * which accepts a move only when the whole result passes `validateLayout`. A native
 * `<form method="POST">` carries one hidden JSON field, which the endpoint judges again.
 *
 * Wires and lengths belong to the saved layout, so they are hidden while there are unsaved changes (and
 * while a unit is in the air) and come back after the save, routed here in the browser from `wiring`.
 */
export default function LayoutEditor({
  geometry,
  devices,
  groups,
  placements,
  editedManually,
  names,
  wiring,
  wiringVariant = "realistic",
  slackPercent,
  saveAction,
  reproposeAction,
  draftKey,
  restoreDraft,
  initialDraft,
}: LayoutEditorProps): JSX.Element {
  const ids = useId();
  const instructionsId = `${ids}-instructions`;
  const reproposeFormId = `${ids}-repropose`;

  const context = useMemo<EditContext>(() => ({ devices, geometry, groups }), [devices, geometry, groups]);
  const saved = useMemo(() => normalised(placements, devices), [placements, devices]);
  const units = useMemo(() => editUnits(devices, groups, geometry), [devices, groups, geometry]);
  const unitByDevice = useMemo(
    () => new Map(units.flatMap((unit) => (unit.kind === "device" ? [[unit.deviceId, unit] as const] : []))),
    [units],
  );
  const unitByGroup = useMemo(
    () => new Map(units.flatMap((unit) => (unit.kind === "block" ? [[unit.groupId, unit] as const] : []))),
    [units],
  );

  const [boot] = useState(() => {
    if (initialDraft !== undefined) return { draft: normalised(initialDraft, devices), restored: true };
    const stored = restoreDraft ? readStoredDraft(draftKey, draftSchema) : null;
    // A stored draft is kept only when it still describes this snapshot: the same devices, and a layout
    // that passes the validator. A re-match in another tab gives the devices new ids.
    const current = new Set(devices.map((device) => device.id));
    const usable =
      stored !== null &&
      stored.placements.length === current.size &&
      stored.placements.every((placement) => current.has(placement.projectDeviceId)) &&
      validateLayout(devices, stored.placements, geometry, groups).length === 0;
    return usable
      ? { draft: normalised(stored.placements, devices), restored: true }
      : { draft: saved, restored: false };
  });
  const [hist, setHist] = useState<History<LayoutDraft>>(() => history.start(boot.draft));
  const draft = hist.present;

  const [drag, setDrag] = useState<PointerDrag | null>(null);
  const [lift, setLift] = useState<KeyboardLift | null>(null);
  const [selected, setSelected] = useState<{ kind: "device" | "group"; id: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dragRef = useRef<PointerDrag | null>(null);
  const drawingRef = useRef<HTMLDivElement>(null);
  /** Set while the page is being left on purpose (a save or a re-propose), so `beforeunload` stays quiet. */
  const leaving = useRef(false);
  const announceTick = useRef(false);

  const dirty = !samePlacements(draft, saved);
  const moving = drag ?? lift;

  // Any visit that is not the return from a rejection discards the stored draft.
  useEffect(() => {
    if (!restoreDraft || !boot.restored) clearStoredDraft(draftKey);
  }, [restoreDraft, boot.restored, draftKey]);

  // Back-navigation can restore this page from the bfcache mid-submit; re-enable the buttons.
  useEffect(() => {
    const onPageShow = () => {
      leaving.current = false;
      setSubmitting(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  // Other forms on the page navigate away: do not drop an unsaved layout silently.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leaving.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);

  // ---- What is drawn -----------------------------------------------------------------------------

  const shown = useMemo(
    () => (moving ? previewMove(context, draft, moving.unit, moving.target) : draft),
    [context, draft, moving],
  );
  const drawnList = useMemo(
    () => buildDrawnDevices(devices, shown.placements, geometry, groups),
    [devices, shown, geometry, groups],
  );
  const drawn = useMemo(() => new Map(drawnList.map((device) => [device.id, device])), [drawnList]);

  const wiresHidden = dirty || moving !== null;

  // The wires belong to the saved layout, so they are routed over its devices, not the draft's.
  const savedDrawn = useMemo(
    () => buildDrawnDevices(devices, saved.placements, geometry, groups),
    [devices, saved, geometry, groups],
  );
  const savedWiring = useWiringDrawing(wiring, savedDrawn, wiringVariant);
  const wires = savedWiring?.wires ?? [];
  const cables = savedWiring?.cables ?? [];
  const ties = savedWiring?.ties ?? [];
  const lengths = savedWiring?.lengths ?? [];

  // ---- Announcements ------------------------------------------------------------------------------

  function announce(message: string) {
    // A trailing no-break space makes a repeated message a change the live region announces again.
    announceTick.current = !announceTick.current;
    setAnnouncement(announceTick.current ? `${message}${NBSP}` : message);
  }

  function subjectOf(unit: EditUnit): string {
    return unit.kind === "block"
      ? e.groupSubject(names.groups[unit.groupId] ?? unit.groupId)
      : e.deviceSubject(names.devices[unit.deviceId] ?? unit.deviceId);
  }

  function describe(target: MoveTarget): { rail: number; position: string } {
    return { rail: target.railIndex + 1, position: formatNumber(target.xMm / DIN_MODULE_MM) };
  }

  function reasonOf(issues: readonly LayoutIssue[]): string {
    const first = issues.at(0);
    return first === undefined ? "" : layoutIssueMessage(first, names);
  }

  // ---- Moves ---------------------------------------------------------------------------------------

  function commit(next: LayoutDraft) {
    setHist((current) => history.commit(current, next));
  }

  /**
   * The drop of a unit at `target`: accepted into the history, or refused with the reason. An accepted
   * drop reports where the unit actually landed — a reorder re-packs its group, so that is not always
   * `target` — and whether anything changed at all.
   */
  function judge(
    unit: EditUnit,
    target: MoveTarget,
  ): { accepted: true; changed: boolean; landed: MoveTarget } | { accepted: false; reason: string } {
    const result = moveUnit(context, draft, unit, target);
    if (!result.ok) return { accepted: false, reason: reasonOf(result.issues) };
    const changed = !samePlacements(result.draft, draft);
    if (changed) commit(result.draft);
    return { accepted: true, changed, landed: landedOf(unit, result.draft) ?? target };
  }

  /** Where a unit sits in `next`: a device's own placement, a block's leftmost member. */
  function landedOf(unit: EditUnit, next: LayoutDraft): MoveTarget | null {
    const ids = new Set(unitDeviceIds(unit));
    const placements = next.placements.filter((placement) => ids.has(placement.projectDeviceId));
    const first = placements.reduce<Placement | null>(
      (best, placement) => (best === null || placement.xMm < best.xMm ? placement : best),
      null,
    );
    return first === null ? null : { railIndex: first.railIndex, xMm: first.xMm };
  }

  /** The announcement for an accepted drop. */
  function droppedMessage(unit: EditUnit, verdict: { changed: boolean; landed: MoveTarget }): string {
    if (!verdict.changed) return e.droppedInPlace(subjectOf(unit));
    const { rail, position } = describe(verdict.landed);
    return e.dropped(subjectOf(unit), rail, position);
  }

  function originOf(unit: EditUnit): MoveTarget | null {
    const first = drawnMembers(drawn, unit).at(0);
    if (first === undefined) return null;
    const placement = draft.placements.find((candidate) => candidate.projectDeviceId === first.id);
    return placement === undefined ? null : { railIndex: placement.railIndex, xMm: placement.xMm };
  }

  // ---- Pointer ---------------------------------------------------------------------------------------

  /** A pointer position in the drawing's millimetres: the SVG is 1 unit = 1 mm, so its screen CTM is all it takes. */
  function toMm(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = drawingRef.current?.querySelector("svg");
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  function targetFor(current: PointerDrag, point: { x: number; y: number }): MoveTarget {
    const centreY = point.y - current.grabDy;
    let railIndex = 0;
    let best = Infinity;
    geometry.rails.forEach((rail, index) => {
      const distance = Math.abs(rail.yMm + RAIL_HEIGHT_MM / 2 - centreY);
      if (distance < best) {
        best = distance;
        railIndex = index;
      }
    });
    const rail = geometry.rails[railIndex];
    return { railIndex, xMm: snapX(rail, point.x - current.grabDx - rail.xMm, current.width) };
  }

  function startDrag(event: ReactPointerEvent<SVGGElement>, unit: EditUnit) {
    if (event.button !== 0 || lift !== null || drag !== null) return;
    const members = drawnMembers(drawn, unit);
    const first = members.at(0);
    const origin = originOf(unit);
    const point = toMm(event.clientX, event.clientY);
    if (first === undefined || origin === null || point === null) return;
    const next: PointerDrag = {
      unit,
      grabDx: point.x - first.rect.x,
      grabDy: point.y - (first.rect.y + first.rect.h / 2),
      width: members.reduce((sum, member) => sum + member.rect.w, 0),
      origin,
      target: origin,
    };
    dragRef.current = next;
    setDrag(next);
    setRefusal(null);
    // Listen right away, not in an effect after the re-render: a fast press-move-release would
    // otherwise deliver its pointerup before anyone listens, and the drop would be lost.
    window.addEventListener("pointermove", windowListeners.move);
    window.addEventListener("pointerup", windowListeners.up);
    window.addEventListener("pointercancel", windowListeners.cancel);
    window.addEventListener("keydown", windowListeners.key);
  }

  function endDrag() {
    window.removeEventListener("pointermove", windowListeners.move);
    window.removeEventListener("pointerup", windowListeners.up);
    window.removeEventListener("pointercancel", windowListeners.cancel);
    window.removeEventListener("keydown", windowListeners.key);
    dragRef.current = null;
    setDrag(null);
  }

  // The handlers of the latest render; the window listeners call through this ref, so they always see
  // the current draft and context while staying the same functions to add and remove.
  const dragHandlers = useRef<DragHandlers | null>(null);
  const latestDragHandlers: DragHandlers = {
    move: (event: PointerEvent) => {
      const current = dragRef.current;
      const point = toMm(event.clientX, event.clientY);
      if (current === null || point === null) return;
      const next = { ...current, target: targetFor(current, point) };
      dragRef.current = next;
      setDrag(next);
    },
    up: () => {
      const current = dragRef.current;
      endDrag();
      if (current === null) return;
      if (
        current.target.railIndex === current.origin.railIndex &&
        Math.abs(current.target.xMm - current.origin.xMm) < EPS
      ) {
        return;
      }
      const verdict = judge(current.unit, current.target);
      if (verdict.accepted) {
        setRefusal(null);
        announce(droppedMessage(current.unit, verdict));
      } else {
        // A refused drop snaps back: the drag state is already gone, so the unit is drawn at its origin.
        setRefusal(verdict.reason);
        announce(e.refusedSnapBack(subjectOf(current.unit), verdict.reason));
      }
    },
    cancel: () => {
      endDrag();
    },
    key: (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const current = dragRef.current;
      endDrag();
      if (current !== null) announce(e.cancelled(subjectOf(current.unit)));
    },
  };
  // A layout effect runs synchronously after every commit, before the browser delivers the next event.
  useLayoutEffect(() => {
    dragHandlers.current = latestDragHandlers;
  });

  // Stable functions to add and remove; each forwards to the latest render's handler.
  const [windowListeners] = useState(() => ({
    move: (event: PointerEvent) => dragHandlers.current?.move(event),
    up: () => dragHandlers.current?.up(),
    cancel: () => dragHandlers.current?.cancel(),
    key: (event: KeyboardEvent) => dragHandlers.current?.key(event),
  }));

  // A drag in progress when the island unmounts must not leave its listeners on the window.
  useEffect(
    () => () => {
      window.removeEventListener("pointermove", windowListeners.move);
      window.removeEventListener("pointerup", windowListeners.up);
      window.removeEventListener("pointercancel", windowListeners.cancel);
      window.removeEventListener("keydown", windowListeners.key);
    },
    [windowListeners],
  );

  // ---- Keyboard ---------------------------------------------------------------------------------------

  function startLift(unit: EditUnit) {
    const origin = originOf(unit);
    if (origin === null) return;
    setLift({ unit, target: origin, refused: false });
    setRefusal(null);
    announce(e.pickedUp(subjectOf(unit)));
  }

  function stepLift(current: KeyboardLift, direction: StepDirection) {
    const next = keyboardStep(context, shown, current.unit, direction);
    if (next === null) return;
    setLift({ ...current, target: next, refused: false });
    setRefusal(null);
    const { rail, position } = describe(next);
    announce(e.movedTo(subjectOf(current.unit), rail, position));
  }

  function dropLift(current: KeyboardLift) {
    const verdict = judge(current.unit, current.target);
    if (verdict.accepted) {
      setLift(null);
      setRefusal(null);
      announce(droppedMessage(current.unit, verdict));
    } else {
      // A refused keyboard drop keeps the unit in the air where it is; Escape returns it to its origin.
      setLift({ ...current, refused: true });
      setRefusal(verdict.reason);
      announce(e.refused(subjectOf(current.unit), verdict.reason));
    }
  }

  function cancelLift(current: KeyboardLift) {
    setLift(null);
    setRefusal(null);
    announce(e.cancelled(subjectOf(current.unit)));
  }

  const ARROWS: Partial<Record<string, StepDirection>> = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
  };

  function handleKey(event: ReactKeyboardEvent<SVGGElement>, unit: EditUnit) {
    if (event.ctrlKey || event.metaKey || event.altKey || drag !== null) return;
    if (lift !== null && !sameUnit(lift.unit, unit)) return;
    if (lift === null) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        startLift(unit);
      }
      return;
    }
    const direction = ARROWS[event.key];
    if (direction !== undefined) {
      event.preventDefault();
      stepLift(lift, direction);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      dropLift(lift);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelLift(lift);
    }
  }

  // ---- Undo, redo, cancel ------------------------------------------------------------------------------

  function undo() {
    if (hist.past.length === 0) return;
    setHist((current) => history.undo(current));
    setRefusal(null);
    announce(e.undone);
  }

  function redo() {
    if (hist.future.length === 0) return;
    setHist((current) => history.redo(current));
    setRefusal(null);
    announce(e.redone);
  }

  function discard() {
    setHist(history.reset(saved));
    setDrag(null);
    dragRef.current = null;
    setLift(null);
    setRefusal(null);
    announce(e.discarded);
  }

  function handleShortcut(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey) || drag !== null || lift !== null) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      redo();
    }
  }

  // ---- Submit ----------------------------------------------------------------------------------------

  const payloadOk =
    parsePlacementsPayload(draft.placements).ok &&
    validateLayout(devices, draft.placements, geometry, groups).length === 0;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    if (!dirty || !payloadOk || submitting) {
      event.preventDefault();
      return;
    }
    writeStoredDraft(draftKey, draft);
    leaving.current = true;
    setSubmitting(true);
  }

  // ---- Interaction props ------------------------------------------------------------------------------

  function elementProps(unit: EditUnit | undefined, label: string, isLifted: boolean): SVGProps<SVGGElement> {
    if (unit === undefined) return {};
    return {
      tabIndex: 0,
      role: "button",
      "aria-label": label,
      "aria-describedby": instructionsId,
      "aria-pressed": isLifted,
      className: cn("touch-none outline-none", isLifted ? "cursor-grabbing" : "cursor-grab"),
      onPointerDown: (event: ReactPointerEvent<SVGGElement>) => {
        startDrag(event, unit);
      },
      onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => {
        handleKey(event, unit);
      },
      onBlur: () => {
        setSelected(null);
        if (lift !== null && sameUnit(lift.unit, unit)) cancelLift(lift);
      },
    };
  }

  const liftedUnit = moving?.unit ?? null;
  const liftedIds = liftedUnit === null ? [] : unitDeviceIds(liftedUnit);
  const refusedIds = lift?.refused === true ? liftedIds : [];

  const interactive: DrawingInteraction = {
    deviceProps: (deviceId) => {
      const unit = unitByDevice.get(deviceId);
      const device = drawn.get(deviceId);
      if (unit === undefined || device === undefined) return {};
      const { rail, position } = describe({
        railIndex: device.railIndex,
        xMm: shown.placements.find((placement) => placement.projectDeviceId === deviceId)?.xMm ?? 0,
      });
      return {
        ...elementProps(
          unit,
          e.deviceLabel(names.devices[deviceId] ?? deviceId, rail, position),
          liftedIds.includes(deviceId),
        ),
        onFocus: () => {
          setSelected({ kind: "device", id: deviceId });
        },
      };
    },
    groupHandleProps: (groupId) => {
      const unit = unitByGroup.get(groupId);
      if (unit === undefined) return {};
      const first = drawnMembers(drawn, unit).at(0);
      const { rail, position } = describe({
        railIndex: first?.railIndex ?? 0,
        xMm: shown.placements.find((placement) => placement.projectDeviceId === first?.id)?.xMm ?? 0,
      });
      return {
        ...elementProps(
          unit,
          e.groupLabel(names.groups[groupId] ?? groupId, rail, position),
          liftedUnit !== null && sameUnit(liftedUnit, unit),
        ),
        onFocus: () => {
          setSelected({ kind: "group", id: groupId });
        },
      };
    },
    selectedId: selected?.kind === "device" ? selected.id : null,
    selectedGroupId: selected?.kind === "group" ? selected.id : null,
    liftedIds,
    refusedIds,
  };

  return (
    <div className="flex flex-col gap-3" role="group" aria-label={e.label} onKeyDown={handleShortcut}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-muted-foreground max-w-prose text-xs">{e.hint}</p>
        {editedManually && <Badge variant="secondary">{t.projects.page.layoutEditedManually}</Badge>}
      </div>
      <p id={instructionsId} className="sr-only">
        {e.instructions}
      </p>

      <div ref={drawingRef} className="mx-auto w-full max-w-3xl">
        <CabinetDrawing
          geometry={geometry}
          devices={drawnList}
          wires={wires}
          cables={cables}
          ties={ties}
          wiring={wiringVariant}
          hideWires={wiresHidden}
          interactive={interactive}
        />
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {refusal !== null && (
        <Alert variant="warning" role={undefined}>
          <AlertTitle>{e.refusalTitle}</AlertTitle>
          <AlertDescription>{refusal}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <form
          method="POST"
          action={saveAction}
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name={LAYOUT_FORM_FIELDS.placements} value={JSON.stringify(draft.placements)} />
          <Button type="submit" size="sm" pending={submitting} disabled={!dirty || !payloadOk}>
            {!submitting && <Save aria-hidden="true" />}
            {submitting ? e.saving : e.save}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={discard} disabled={!dirty || submitting}>
            {e.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={undo}
            disabled={hist.past.length === 0 || submitting}
          >
            <Undo2 aria-hidden="true" />
            {e.undo}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={redo}
            disabled={hist.future.length === 0 || submitting}
          >
            <Redo2 aria-hidden="true" />
            {e.redo}
          </Button>
        </form>

        {(editedManually || dirty) && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" size="sm" variant="outline" disabled={submitting}>
                <WandSparkles aria-hidden="true" />
                {e.repropose}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{e.reproposeTitle}</AlertDialogTitle>
                <AlertDialogDescription>{e.reproposeDescription}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{e.reproposeKeep}</AlertDialogCancel>
                <AlertDialogAction type="submit" form={reproposeFormId}>
                  {e.reproposeConfirm}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {/* The dialog's confirm button submits this form by id: the dialog is portalled out of the tree. */}
        <form
          id={reproposeFormId}
          method="POST"
          action={reproposeAction}
          onSubmit={() => {
            leaving.current = true;
            // Re-proposing discards the manual draft, so a failed re-propose must not bring it back.
            clearStoredDraft(draftKey);
          }}
        />

        {dirty && <p className="text-muted-foreground text-xs">{e.unsaved}</p>}
      </div>

      <LayoutLegend
        geometry={geometry}
        devices={drawnList}
        wires={wiresHidden ? [] : wires}
        cables={wiresHidden ? [] : cables}
        ties={wiresHidden ? [] : ties}
        wiring={wiringVariant}
      />

      {!wiresHidden && wiring !== null && savedWiring === null && (
        <p role="status" className="text-muted-foreground text-xs">
          {t.layout.section.wiresLoading}
        </p>
      )}
      {!wiresHidden &&
        savedWiring?.warnings.map((warning) => (
          <Alert key={warning.code} variant="warning" role="status">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertDescription className="block">{wiringWarningMessage(warning)}</AlertDescription>
          </Alert>
        ))}

      {dirty ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{t.layout.section.lengthsTitle}</h3>
          <p className="text-muted-foreground text-xs">{e.wiresAfterSave}</p>
        </div>
      ) : (
        lengths.length > 0 && <WireLengthsTable lengths={lengths} slackPercent={slackPercent} />
      )}
    </div>
  );
}
