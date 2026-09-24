import { useEffect, useState, type ReactNode, type SubmitEvent } from "react";
import { CircleAlert, Save } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import { CabinetDrawing } from "@/components/cabinets/CabinetDrawing";
import { clearStoredDraft, readStoredDraft, writeStoredDraft } from "@/components/forms/draft-storage";
import { AddButton, NumberField, RemoveButton, Section, SelectField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { CABINETS_PATH } from "@/lib/cabinet-catalog";
import { issueElements } from "@/lib/cabinet-drawing";
import {
  cabinetDraftSchema,
  draftFromRow,
  geometryFromDraft,
  isDrawable,
  newBarDraft,
  newEntryDraft,
  newRailDraft,
  newTerminalGroupDraft,
  type BarDraft,
  type CabinetDraft,
  type EntryDraft,
  type GeometryDraft,
  type RailDraft,
  type TerminalGroupDraft,
} from "@/lib/cabinet-draft";
import { CABINET_FORM_FIELDS, type CabinetRow } from "@/lib/cabinet-form";
import { parsePriceGrosze } from "@/lib/price-input";
import {
  BAR_KINDS,
  BAR_ORIENTATIONS,
  ENTRY_SIDES,
  RAIL_HEIGHT_MM,
  geometryIssueMessage,
  parseCabinetGeometry,
  type CabinetGeometry,
  type GeometryElementKind,
  type GeometryIssue,
} from "@/lib/cabinet-geometry";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface CabinetEditorProps {
  /** The row being edited; omitted for a new cabinet. */
  initial?: CabinetRow;
  /** The endpoint the native form posts to. */
  action: string;
  /** The Polish text for the page's `?error=` code. Its presence also restores the stored draft. */
  error?: string;
}

type ScalarField = "name" | "manufacturer" | "model" | "price";

/** A server-side rejection reloads the page; the draft stored on submit is restored from here. */
function draftStorageKey(id: string | undefined): string {
  return `cabinet-draft:${id ?? "new"}`;
}

interface Highlight {
  kind: GeometryElementKind;
  index: number;
}

/** `lastDrawable` keeps the preview on the last renderable state while a field is half-typed. */
interface EditorState {
  draft: CabinetDraft;
  lastDrawable: CabinetGeometry | null;
}

function stateFor(draft: CabinetDraft, previous: CabinetGeometry | null): EditorState {
  const candidate = geometryFromDraft(draft.geometry);
  return { draft, lastDrawable: isDrawable(candidate) ? candidate : previous };
}

// ---------------------------------------------------------------------------------------------------
// Validation derived from the draft
// ---------------------------------------------------------------------------------------------------

/** The same price parser the endpoint uses, so the browser and the server agree on what is valid. */
function scalarErrors(draft: CabinetDraft): Partial<Record<ScalarField, string>> {
  const errors: Partial<Record<ScalarField, string>> = {};
  if (!draft.name.trim()) errors.name = t.cabinets.editor.nameRequired;
  if (!draft.manufacturer.trim()) errors.manufacturer = t.cabinets.editor.manufacturerRequired;
  if (!draft.model.trim()) errors.model = t.cabinets.editor.modelRequired;
  if (parsePriceGrosze(draft.price) === null) errors.price = t.cabinets.editor.priceInvalid;
  return errors;
}

function issuesOf(issues: readonly GeometryIssue[], kind: GeometryElementKind, index: number): GeometryIssue[] {
  return issues.filter((issue) => issue.element?.kind === kind && issue.element.index === index);
}

const NO_TOUCHED: Record<ScalarField, boolean> = { name: false, manufacturer: false, model: false, price: false };
const ALL_TOUCHED: Record<ScalarField, boolean> = { name: true, manufacturer: true, model: true, price: true };

function replaceAt<T>(items: readonly T[], index: number, next: T): T[] {
  return items.map((item, i) => (i === index ? next : item));
}

function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

// ---------------------------------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------------------------------

function IssueList({ issues }: { issues: readonly GeometryIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1" aria-live="polite">
      {issues.map((issue) => (
        <li
          key={`${issue.code}-${issue.element?.kind ?? ""}-${String(issue.element?.index ?? "")}`}
          className="flex items-start gap-1 text-xs text-red-300"
        >
          <CircleAlert className="mt-0.5 size-3 shrink-0" />
          {geometryIssueMessage(issue)}
        </li>
      ))}
    </ul>
  );
}

interface ElementCardProps {
  legend: string;
  active: boolean;
  invalid: boolean;
  issues: readonly GeometryIssue[];
  onFocus: () => void;
  onRemove: () => void;
  children: ReactNode;
}

/** One rail, entry or bar. Focus anywhere inside it highlights the element in the preview. */
function ElementCard({ legend, active, invalid, issues, onFocus, onRemove, children }: ElementCardProps) {
  return (
    <fieldset
      onFocus={onFocus}
      className={cn(
        "rounded-xl border bg-white/5 p-3 transition-colors",
        invalid ? "border-red-400/50" : active ? "border-fuchsia-400/70" : "border-white/10",
      )}
    >
      <legend className="sr-only">{legend}</legend>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span aria-hidden="true" className="text-sm font-semibold text-white">
          {legend}
        </span>
        <RemoveButton
          label={t.cabinets.editor.removeElement(legend)}
          text={t.cabinets.editor.remove}
          onClick={onRemove}
        />
      </div>
      {children}
      <IssueList issues={issues} />
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------------------------------

/**
 * The cabinet create/edit form; mount it `client:only="react"` (see the draft restore below). A
 * native `<form method="POST">` carries the scalar fields and a hidden `geometry` JSON input, so the
 * endpoint reads plain `FormData` like every other form here.
 * The preview redraws on every keystroke and outlines the element being edited; any issue from
 * `parseCabinetGeometry` is shown next to its element and blocks the submit — the server parses the
 * same document again.
 */
export default function CabinetEditor({ initial, action, error }: CabinetEditorProps) {
  const storageKey = draftStorageKey(initial?.id);
  // Mounted `client:only`, so this first render already runs in the browser and can read the draft
  // a server-side rejection left behind — no SSR pass that would render the unrestored form first.
  const [boot] = useState(() => {
    const stored = error ? readStoredDraft(storageKey, cabinetDraftSchema) : null;
    return { draft: stored ?? draftFromRow(initial), restored: stored !== null };
  });
  const [state, setState] = useState<EditorState>(() => stateFor(boot.draft, null));
  const [touched, setTouched] = useState(boot.restored ? ALL_TOUCHED : NO_TOUCHED);
  const [active, setActive] = useState<Highlight | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Any visit that is not the return from a rejection discards the stored draft, so an abandoned
  // edit never resurfaces later.
  useEffect(() => {
    if (!error) clearStoredDraft(storageKey);
  }, [error, storageKey]);

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

  const { draft, lastDrawable } = state;
  const candidate = geometryFromDraft(draft.geometry);
  const parsed = parseCabinetGeometry(candidate);
  const issues = parsed.ok ? [] : parsed.issues;
  const errors = scalarErrors(draft);
  const canSubmit = parsed.ok && Object.keys(errors).length === 0;
  const candidateDrawable = isDrawable(candidate);
  const preview = candidateDrawable ? candidate : lastDrawable;

  const interiorIssues = issues.filter(
    (issue) => !issue.element && issue.code !== "no_rails" && issue.code !== "no_entries",
  );
  const noRails = issues.filter((issue) => issue.code === "no_rails");
  const noEntries = issues.filter((issue) => issue.code === "no_entries");

  function update(change: (draft: CabinetDraft) => CabinetDraft) {
    setState((previous) => stateFor(change(previous.draft), previous.lastDrawable));
  }

  function updateGeometry(change: (geometry: GeometryDraft) => GeometryDraft) {
    update((previous) => ({ ...previous, geometry: change(previous.geometry) }));
  }

  function setScalar(field: ScalarField, value: string) {
    update((previous) => ({ ...previous, [field]: value }));
  }

  function touch(field: ScalarField) {
    setTouched((previous) => ({ ...previous, [field]: true }));
  }

  function setInterior(field: keyof GeometryDraft["interior"], value: string) {
    updateGeometry((geometry) => ({ ...geometry, interior: { ...geometry.interior, [field]: value } }));
  }

  function setRail(index: number, change: Partial<RailDraft>) {
    updateGeometry((geometry) => ({
      ...geometry,
      rails: replaceAt(geometry.rails, index, { ...geometry.rails[index], ...change }),
    }));
  }

  function setEntry(index: number, change: Partial<EntryDraft>) {
    updateGeometry((geometry) => ({
      ...geometry,
      entries: replaceAt(geometry.entries, index, { ...geometry.entries[index], ...change }),
    }));
  }

  function setBar(index: number, change: Partial<BarDraft>) {
    updateGeometry((geometry) => ({
      ...geometry,
      bars: replaceAt(geometry.bars, index, { ...geometry.bars[index], ...change }),
    }));
  }

  function setTerminalGroup(barIndex: number, groupIndex: number, change: Partial<TerminalGroupDraft>) {
    updateGeometry((geometry) => {
      const bar = geometry.bars[barIndex];
      const groups = replaceAt(bar.terminalGroups, groupIndex, { ...bar.terminalGroups[groupIndex], ...change });
      return { ...geometry, bars: replaceAt(geometry.bars, barIndex, { ...bar, terminalGroups: groups }) };
    });
  }

  function setTerminalGroups(barIndex: number, change: (groups: TerminalGroupDraft[]) => TerminalGroupDraft[]) {
    updateGeometry((geometry) => {
      const bar = geometry.bars[barIndex];
      return {
        ...geometry,
        bars: replaceAt(geometry.bars, barIndex, { ...bar, terminalGroups: change(bar.terminalGroups) }),
      };
    });
  }

  function removeElement(kind: GeometryElementKind, index: number) {
    updateGeometry((geometry) => {
      switch (kind) {
        case "rail":
          return { ...geometry, rails: removeAt(geometry.rails, index) };
        case "entry":
          return { ...geometry, entries: removeAt(geometry.entries, index) };
        case "bar":
          return { ...geometry, bars: removeAt(geometry.bars, index) };
      }
    });
    setActive(null);
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    if (!canSubmit || submitting) {
      event.preventDefault();
      setTouched(ALL_TOUCHED);
      return;
    }
    writeStoredDraft(storageKey, draft);
    setSubmitting(true);
  }

  const scalarError = (field: ScalarField) => (touched[field] ? errors[field] : undefined);
  const isActive = (kind: GeometryElementKind, index: number) => active?.kind === kind && active.index === index;
  const f = t.cabinets.fields;
  const e = t.cabinets.editor;

  return (
    <form
      method="POST"
      action={action}
      onSubmit={handleSubmit}
      noValidate
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]"
    >
      <input type="hidden" name={CABINET_FORM_FIELDS.geometry} value={JSON.stringify(candidate)} />

      <div className="flex min-w-0 flex-col gap-6">
        <ServerError message={error} />

        <Section title={e.catalogSection}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              id="cabinet-name"
              name={CABINET_FORM_FIELDS.name}
              label={f.name}
              value={draft.name}
              onChange={(value) => {
                setScalar("name", value);
              }}
              onBlur={() => {
                touch("name");
              }}
              error={scalarError("name")}
            />
            <TextField
              id="cabinet-price"
              name={CABINET_FORM_FIELDS.price}
              label={f.price}
              value={draft.price}
              inputMode="decimal"
              placeholder={e.pricePlaceholder}
              hint={e.priceHint}
              onChange={(value) => {
                setScalar("price", value);
              }}
              onBlur={() => {
                touch("price");
              }}
              error={scalarError("price")}
            />
            <TextField
              id="cabinet-manufacturer"
              name={CABINET_FORM_FIELDS.manufacturer}
              label={f.manufacturer}
              value={draft.manufacturer}
              onChange={(value) => {
                setScalar("manufacturer", value);
              }}
              onBlur={() => {
                touch("manufacturer");
              }}
              error={scalarError("manufacturer")}
            />
            <TextField
              id="cabinet-model"
              name={CABINET_FORM_FIELDS.model}
              label={f.model}
              value={draft.model}
              onChange={(value) => {
                setScalar("model", value);
              }}
              onBlur={() => {
                touch("model");
              }}
              error={scalarError("model")}
            />
          </div>
        </Section>

        <Section title={t.cabinets.interior} hint={e.interiorHint}>
          <div
            className="grid gap-3 sm:grid-cols-3"
            onFocus={() => {
              setActive(null);
            }}
          >
            <NumberField
              id="cabinet-interior-width"
              label={f.widthMm}
              value={draft.geometry.interior.widthMm}
              onChange={(value) => {
                setInterior("widthMm", value);
              }}
            />
            <NumberField
              id="cabinet-interior-height"
              label={f.heightMm}
              value={draft.geometry.interior.heightMm}
              onChange={(value) => {
                setInterior("heightMm", value);
              }}
            />
            <NumberField
              id="cabinet-interior-depth"
              label={f.depthMm}
              value={draft.geometry.interior.depthMm}
              onChange={(value) => {
                setInterior("depthMm", value);
              }}
            />
          </div>
          <IssueList issues={interiorIssues} />
        </Section>

        <Section title={e.railsSection} hint={e.railsHint(RAIL_HEIGHT_MM)}>
          {draft.geometry.rails.map((rail, index) => {
            const railIssues = issuesOf(issues, "rail", index);
            const id = `cabinet-rail-${String(index)}`;
            return (
              <ElementCard
                key={rail.key}
                legend={t.cabinets.elementNumbered.rail(index + 1)}
                active={isActive("rail", index)}
                invalid={railIssues.length > 0}
                issues={railIssues}
                onFocus={() => {
                  setActive({ kind: "rail", index });
                }}
                onRemove={() => {
                  removeElement("rail", index);
                }}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <NumberField
                    id={`${id}-x`}
                    label={f.xMm}
                    value={rail.xMm}
                    onChange={(value) => {
                      setRail(index, { xMm: value });
                    }}
                  />
                  <NumberField
                    id={`${id}-y`}
                    label={f.yMm}
                    value={rail.yMm}
                    onChange={(value) => {
                      setRail(index, { yMm: value });
                    }}
                  />
                  <NumberField
                    id={`${id}-length`}
                    label={f.lengthMm}
                    value={rail.lengthMm}
                    onChange={(value) => {
                      setRail(index, { lengthMm: value });
                    }}
                  />
                </div>
              </ElementCard>
            );
          })}
          <IssueList issues={noRails} />
          <AddButton
            onClick={() => {
              updateGeometry((geometry) => ({ ...geometry, rails: [...geometry.rails, newRailDraft(geometry)] }));
            }}
          >
            {e.addRail}
          </AddButton>
        </Section>

        <Section title={e.entriesSection} hint={e.entriesHint}>
          {draft.geometry.entries.map((entry, index) => {
            const entryIssues = issuesOf(issues, "entry", index);
            const id = `cabinet-entry-${String(index)}`;
            return (
              <ElementCard
                key={entry.key}
                legend={t.cabinets.elementNumbered.entry(index + 1)}
                active={isActive("entry", index)}
                invalid={entryIssues.length > 0}
                issues={entryIssues}
                onFocus={() => {
                  setActive({ kind: "entry", index });
                }}
                onRemove={() => {
                  removeElement("entry", index);
                }}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <SelectField
                    id={`${id}-side`}
                    label={f.side}
                    value={entry.side}
                    options={ENTRY_SIDES}
                    labels={t.cabinets.sides}
                    onChange={(side) => {
                      setEntry(index, { side });
                    }}
                  />
                  <NumberField
                    id={`${id}-offset`}
                    label={f.offsetMm}
                    value={entry.offsetMm}
                    onChange={(value) => {
                      setEntry(index, { offsetMm: value });
                    }}
                  />
                  <NumberField
                    id={`${id}-length`}
                    label={f.lengthMm}
                    value={entry.lengthMm}
                    onChange={(value) => {
                      setEntry(index, { lengthMm: value });
                    }}
                  />
                </div>
              </ElementCard>
            );
          })}
          <IssueList issues={noEntries} />
          <AddButton
            onClick={() => {
              updateGeometry((geometry) => ({ ...geometry, entries: [...geometry.entries, newEntryDraft(geometry)] }));
            }}
          >
            {e.addEntry}
          </AddButton>
        </Section>

        <Section title={e.barsSection} hint={e.barsHint}>
          {draft.geometry.bars.length === 0 && <p className="text-sm text-blue-100/60">{e.noBars}</p>}
          {draft.geometry.bars.map((bar, index) => {
            const barIssues = issuesOf(issues, "bar", index);
            const id = `cabinet-bar-${String(index)}`;
            return (
              <ElementCard
                key={bar.key}
                legend={t.cabinets.elementNumbered.bar(index + 1)}
                active={isActive("bar", index)}
                invalid={barIssues.length > 0}
                issues={barIssues}
                onFocus={() => {
                  setActive({ kind: "bar", index });
                }}
                onRemove={() => {
                  removeElement("bar", index);
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    id={`${id}-kind`}
                    label={f.kind}
                    value={bar.kind}
                    options={BAR_KINDS}
                    labels={t.cabinets.barKinds}
                    onChange={(kind) => {
                      setBar(index, { kind });
                    }}
                  />
                  <SelectField
                    id={`${id}-orientation`}
                    label={f.orientation}
                    value={bar.orientation}
                    options={BAR_ORIENTATIONS}
                    labels={t.cabinets.orientations}
                    onChange={(orientation) => {
                      setBar(index, { orientation });
                    }}
                  />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <NumberField
                    id={`${id}-x`}
                    label={f.xMm}
                    value={bar.xMm}
                    onChange={(value) => {
                      setBar(index, { xMm: value });
                    }}
                  />
                  <NumberField
                    id={`${id}-y`}
                    label={f.yMm}
                    value={bar.yMm}
                    onChange={(value) => {
                      setBar(index, { yMm: value });
                    }}
                  />
                  <NumberField
                    id={`${id}-z`}
                    label={f.zMm}
                    value={bar.zMm}
                    onChange={(value) => {
                      setBar(index, { zMm: value });
                    }}
                  />
                  <NumberField
                    id={`${id}-length`}
                    label={f.lengthMm}
                    value={bar.lengthMm}
                    onChange={(value) => {
                      setBar(index, { lengthMm: value });
                    }}
                  />
                  <NumberField
                    id={`${id}-height`}
                    label={e.heightMm}
                    value={bar.heightMm}
                    onChange={(value) => {
                      setBar(index, { heightMm: value });
                    }}
                  />
                </div>

                <h3 className="mt-4 text-sm font-semibold text-white">{f.terminalGroups}</h3>
                <div className="mt-2 flex flex-col gap-2">
                  {bar.terminalGroups.map((group, groupIndex) => {
                    const groupId = `${id}-group-${String(groupIndex)}`;
                    const groupLabel = e.terminalGroupNumbered(groupIndex + 1);
                    return (
                      <div
                        key={group.key}
                        role="group"
                        aria-label={groupLabel}
                        className="grid items-end gap-3 rounded-lg border border-white/10 p-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
                      >
                        <NumberField
                          id={`${groupId}-count`}
                          label={f.terminalCount}
                          value={group.count}
                          onChange={(value) => {
                            setTerminalGroup(index, groupIndex, { count: value });
                          }}
                        />
                        <NumberField
                          id={`${groupId}-min`}
                          label={f.minMm2}
                          value={group.minMm2}
                          decimal
                          onChange={(value) => {
                            setTerminalGroup(index, groupIndex, { minMm2: value });
                          }}
                        />
                        <NumberField
                          id={`${groupId}-max`}
                          label={f.maxMm2}
                          value={group.maxMm2}
                          decimal
                          onChange={(value) => {
                            setTerminalGroup(index, groupIndex, { maxMm2: value });
                          }}
                        />
                        <RemoveButton
                          label={e.removeElement(groupLabel)}
                          text={e.remove}
                          onClick={() => {
                            setTerminalGroups(index, (groups) => removeAt(groups, groupIndex));
                          }}
                        />
                      </div>
                    );
                  })}
                  <AddButton
                    onClick={() => {
                      setTerminalGroups(index, (groups) => [...groups, newTerminalGroupDraft()]);
                    }}
                  >
                    {e.addTerminalGroup}
                  </AddButton>
                </div>
              </ElementCard>
            );
          })}
          <AddButton
            onClick={() => {
              updateGeometry((geometry) => ({ ...geometry, bars: [...geometry.bars, newBarDraft()] }));
            }}
          >
            {e.addBar}
          </AddButton>
        </Section>
      </div>

      <aside className="flex flex-col gap-4 self-start lg:sticky lg:top-4">
        <section className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl">
          <h2 className="mb-3 text-lg font-semibold text-white">{e.preview}</h2>
          <div className="rounded-lg bg-white/90 p-3">
            {preview ? (
              <CabinetDrawing
                geometry={preview}
                highlight={active ?? undefined}
                // Issue indices describe the candidate, so they only apply when it is what is drawn.
                invalid={candidateDrawable ? issueElements(issues) : undefined}
                className="max-h-[70vh]"
              />
            ) : (
              <p className="py-8 text-center text-sm text-zinc-700">{e.previewUnavailable}</p>
            )}
          </div>
          {preview && !candidateDrawable && <p className="mt-2 text-xs text-amber-200">{e.previewStale}</p>}
        </section>

        {!canSubmit && (
          <p className="flex items-start gap-2 text-sm text-amber-200" role="status">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {e.blocked}
          </p>
        )}
        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={!canSubmit || submitting}
            className="flex-1 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
          >
            {submitting ? (
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Save className="size-4" />
            )}
            {submitting ? e.saving : e.save}
          </Button>
          <a
            href={CABINETS_PATH}
            className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
          >
            {e.cancel}
          </a>
        </div>
      </aside>
    </form>
  );
}
