import { useEffect, useState, type SubmitEvent } from "react";
import { CircleAlert, Save } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import { clearStoredDraft, readStoredDraft, writeStoredDraft } from "@/components/forms/draft-storage";
import { AddButton, NumberField, RemoveButton, Section, SelectField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { DEVICES_PATH } from "@/lib/device-catalog";
import {
  WIDTH_UNITS,
  deviceDraftSchema,
  draftFromRow,
  formValuesFromDraft,
  isBarKind,
  newTerminalGroupDraft,
  widthMmFromDraft,
  withKind,
  withWidthUnit,
  type DeviceDraft,
  type TerminalGroupDraft,
  type WidthUnit,
} from "@/lib/device-draft";
import { DEVICE_FORM_FIELDS, deviceCandidate, type DeviceRow } from "@/lib/device-form";
import {
  DEVICE_KINDS,
  PARAMETERS_BY_KIND,
  POLES_BY_KIND,
  RCD_TYPES,
  deviceIssueMessage,
  deviceKindLabel,
  parseDeviceSpec,
  type DeviceField,
  type DeviceIssue,
  type DeviceKind,
  type DeviceParameter,
  type PoleConfig,
} from "@/lib/device-spec";
import { numberFromField } from "@/lib/draft-fields";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface DeviceEditorProps {
  /** The row being edited; omitted for a new device. */
  initial?: DeviceRow;
  /** The endpoint the native form posts to. */
  action: string;
  /** The Polish text for the page's `?error=` code. Its presence also restores the stored draft. */
  error?: string;
}

/** A server-side rejection reloads the page; the draft stored on submit is restored from here. */
function draftStorageKey(id: string | undefined): string {
  return `device-draft:${id ?? "new"}`;
}

const KIND_LABELS = Object.fromEntries(DEVICE_KINDS.map((kind) => [kind, deviceKindLabel(kind)])) as Record<
  DeviceKind,
  string
>;

const WIDTH_UNIT_LABELS: Record<WidthUnit, string> = {
  modules: t.devices.widthUnit.modules,
  mm: t.devices.widthUnit.millimetres,
};

function replaceAt<T>(items: readonly T[], index: number, next: T): T[] {
  return items.map((item, i) => (i === index ? next : item));
}

function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

function IssueList({ id, messages }: { id: string; messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul id={id} className="flex flex-col gap-1" aria-live="polite">
      {messages.map((message) => (
        <li key={message} className="flex items-start gap-1 text-xs text-red-300">
          <CircleAlert className="mt-0.5 size-3 shrink-0" />
          {message}
        </li>
      ))}
    </ul>
  );
}

/**
 * The device create/edit form; mount it `client:only="react"` (see the draft restore below). A
 * native `<form method="POST">` carries plain named inputs, a hidden `width_mm` (a width typed in
 * modules is converted before it is sent) and, for bars, a hidden `terminal_groups` JSON input, so
 * the endpoint reads plain `FormData` like every other form here.
 * Only the chosen kind's parameter fields are shown. Every issue `parseDeviceSpec` finds in the
 * submitted values is shown in Polish next to its field and blocks the submit — the server parses
 * the same values again.
 */
export default function DeviceEditor({ initial, action, error }: DeviceEditorProps) {
  const storageKey = draftStorageKey(initial?.id);
  // Mounted `client:only`, so this first render already runs in the browser and can read the draft
  // a server-side rejection left behind — no SSR pass that would render the unrestored form first.
  const [boot] = useState(() => {
    const stored = error ? readStoredDraft(storageKey, deviceDraftSchema) : null;
    // The kind of a saved device is fixed; a stored draft claiming another one is not restored.
    const usable = stored !== null && (!initial || stored.kind === initial.kind) ? stored : null;
    return { draft: usable ?? draftFromRow(initial), restored: usable !== null };
  });
  const [draft, setDraft] = useState<DeviceDraft>(boot.draft);
  const [touched, setTouched] = useState<ReadonlySet<DeviceField>>(new Set());
  const [showAll, setShowAll] = useState(boot.restored);
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

  const values = formValuesFromDraft(draft);
  const parsed = parseDeviceSpec(deviceCandidate(values));
  const issues: readonly DeviceIssue[] = parsed.ok ? [] : parsed.issues;
  const { stepInvalid } = widthMmFromDraft(draft);
  const canSubmit = parsed.ok && !stepInvalid;

  const kind = draft.kind;
  const own: readonly DeviceParameter[] = kind === "" ? [] : PARAMETERS_BY_KIND[kind];
  const has = (field: DeviceParameter) => own.includes(field);
  const poleOptions: readonly PoleConfig[] = kind === "" ? [] : POLES_BY_KIND[kind];

  function messagesFor(field: DeviceField): string[] {
    if (!showAll && !touched.has(field)) return [];
    if (field === "width_mm" && stepInvalid) return [t.devices.editor.widthModulesInvalid];
    return issues.filter((issue) => issue.field === field).map(deviceIssueMessage);
  }

  const errorFor = (field: DeviceField): string | undefined => messagesFor(field).at(0);

  function update(change: Partial<DeviceDraft>) {
    setDraft((previous) => ({ ...previous, ...change }));
  }

  function touch(field: DeviceField) {
    setTouched((previous) => (previous.has(field) ? previous : new Set(previous).add(field)));
  }

  function setTerminalGroup(index: number, change: Partial<TerminalGroupDraft>) {
    setDraft((previous) => ({
      ...previous,
      terminalGroups: replaceAt(previous.terminalGroups, index, { ...previous.terminalGroups[index], ...change }),
    }));
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    if (!canSubmit || submitting) {
      event.preventDefault();
      setShowAll(true);
      return;
    }
    writeStoredDraft(storageKey, draft);
    setSubmitting(true);
  }

  const f = t.devices.fields;
  const e = t.devices.editor;
  const widthMm = numberFromField(values.width_mm);
  const widthHint =
    draft.widthUnit === "modules" && !stepInvalid && Number.isFinite(widthMm) && widthMm > 0
      ? e.widthEquals(widthMm)
      : undefined;
  const terminalMessages = messagesFor("terminal_groups");

  return (
    <form method="POST" action={action} onSubmit={handleSubmit} noValidate className="flex max-w-3xl flex-col gap-6">
      <input type="hidden" name={DEVICE_FORM_FIELDS.width_mm} value={values.width_mm} />
      {isBarKind(kind) && (
        <input type="hidden" name={DEVICE_FORM_FIELDS.terminal_groups} value={values.terminal_groups} />
      )}
      {initial && <input type="hidden" name={DEVICE_FORM_FIELDS.kind} value={initial.kind} />}

      <ServerError message={error} />

      <Section title={e.catalogSection}>
        {initial ? (
          <div>
            <p className="mb-1 text-xs text-blue-100/80">{f.kind}</p>
            <p className="text-sm font-semibold text-white">{deviceKindLabel(initial.kind)}</p>
            <p className="mt-1 text-xs text-blue-100/50">{e.kindLocked}</p>
          </div>
        ) : (
          <SelectField
            id="device-kind"
            name={DEVICE_FORM_FIELDS.kind}
            label={f.kind}
            value={kind}
            options={DEVICE_KINDS}
            labels={KIND_LABELS}
            placeholder={e.kindPlaceholder}
            onChange={(next) => {
              setDraft((previous) => withKind(previous, next));
              touch("kind");
            }}
            error={errorFor("kind")}
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="device-name"
            name={DEVICE_FORM_FIELDS.name}
            label={f.name}
            value={draft.name}
            onChange={(name) => {
              update({ name });
            }}
            onBlur={() => {
              touch("name");
            }}
            error={errorFor("name")}
          />
          <TextField
            id="device-price"
            name={DEVICE_FORM_FIELDS.price}
            label={f.price}
            value={draft.price}
            inputMode="decimal"
            placeholder={e.pricePlaceholder}
            hint={e.priceHint}
            onChange={(price) => {
              update({ price });
            }}
            onBlur={() => {
              touch("price_grosze");
            }}
            error={errorFor("price_grosze")}
          />
          <TextField
            id="device-manufacturer"
            name={DEVICE_FORM_FIELDS.manufacturer}
            label={f.manufacturer}
            value={draft.manufacturer}
            onChange={(manufacturer) => {
              update({ manufacturer });
            }}
            onBlur={() => {
              touch("manufacturer");
            }}
            error={errorFor("manufacturer")}
          />
          <TextField
            id="device-model"
            name={DEVICE_FORM_FIELDS.model}
            label={f.model}
            value={draft.model}
            onChange={(model) => {
              update({ model });
            }}
            onBlur={() => {
              touch("model");
            }}
            error={errorFor("model")}
          />
        </div>
      </Section>

      <Section title={e.dimensionsSection} hint={e.dimensionsHint}>
        <fieldset>
          <legend className="mb-1 block text-xs text-blue-100/80">{t.devices.widthUnit.label}</legend>
          <div className="flex gap-2">
            {WIDTH_UNITS.map((unit) => (
              <label
                key={unit}
                className={cn(
                  "cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-purple-400",
                  draft.widthUnit === unit
                    ? "border-purple-400/70 bg-purple-500/30 text-white"
                    : "border-white/20 bg-white/10 text-blue-100/80 hover:bg-white/20",
                )}
              >
                {/* Named only so the two radios form one keyboard group; the form parser ignores it. */}
                <input
                  type="radio"
                  name="width_unit"
                  value={unit}
                  className="sr-only"
                  checked={draft.widthUnit === unit}
                  onChange={() => {
                    setDraft((previous) => withWidthUnit(previous, unit));
                  }}
                />
                {WIDTH_UNIT_LABELS[unit]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          {/* Unnamed: the hidden `width_mm` input above carries the width, always in millimetres. */}
          <NumberField
            id="device-width"
            label={draft.widthUnit === "modules" ? f.widthModules : f.widthMm}
            value={draft.width}
            decimal
            hint={widthHint}
            onChange={(width) => {
              update({ width });
            }}
            onBlur={() => {
              touch("width_mm");
            }}
            error={errorFor("width_mm")}
          />
          <NumberField
            id="device-height"
            name={DEVICE_FORM_FIELDS.height_mm}
            label={f.heightMm}
            value={draft.heightMm}
            decimal
            onChange={(heightMm) => {
              update({ heightMm });
            }}
            onBlur={() => {
              touch("height_mm");
            }}
            error={errorFor("height_mm")}
          />
          <NumberField
            id="device-depth"
            name={DEVICE_FORM_FIELDS.depth_mm}
            label={f.depthMm}
            value={draft.depthMm}
            decimal
            onChange={(depthMm) => {
              update({ depthMm });
            }}
            onBlur={() => {
              touch("depth_mm");
            }}
            error={errorFor("depth_mm")}
          />
        </div>
      </Section>

      {kind === "" && (
        <Section title={e.parametersSection}>
          <p className="text-sm text-blue-100/60">{e.chooseKindFirst}</p>
        </Section>
      )}

      {kind !== "" && !isBarKind(kind) && (
        <Section title={e.parametersSection}>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="device-poles"
              name={DEVICE_FORM_FIELDS.poles}
              label={f.poles}
              value={draft.poles}
              options={poleOptions}
              labels={t.devices.poles}
              placeholder={e.polesPlaceholder}
              onChange={(poles) => {
                update({ poles });
                touch("poles");
              }}
              error={errorFor("poles")}
            />
            <NumberField
              id="device-rated-current"
              name={DEVICE_FORM_FIELDS.rated_current_a}
              label={f.ratedCurrentA}
              value={draft.ratedCurrentA}
              onChange={(ratedCurrentA) => {
                update({ ratedCurrentA });
              }}
              onBlur={() => {
                touch("rated_current_a");
              }}
              error={errorFor("rated_current_a")}
            />
            {has("residual_current_ma") && (
              <NumberField
                id="device-residual-current"
                name={DEVICE_FORM_FIELDS.residual_current_ma}
                label={f.residualCurrentMa}
                value={draft.residualCurrentMa}
                onChange={(residualCurrentMa) => {
                  update({ residualCurrentMa });
                }}
                onBlur={() => {
                  touch("residual_current_ma");
                }}
                error={errorFor("residual_current_ma")}
              />
            )}
            {has("rcd_type") && (
              <SelectField
                id="device-rcd-type"
                name={DEVICE_FORM_FIELDS.rcd_type}
                label={f.rcdType}
                value={draft.rcdType}
                options={RCD_TYPES}
                labels={t.devices.rcdTypes}
                placeholder={e.rcdTypePlaceholder}
                onChange={(rcdType) => {
                  update({ rcdType });
                  touch("rcd_type");
                }}
                error={errorFor("rcd_type")}
              />
            )}
            {has("breaking_capacity_ka") && (
              <NumberField
                id="device-breaking-capacity"
                name={DEVICE_FORM_FIELDS.breaking_capacity_ka}
                label={f.breakingCapacityKa}
                value={draft.breakingCapacityKa}
                decimal
                onChange={(breakingCapacityKa) => {
                  update({ breakingCapacityKa });
                }}
                onBlur={() => {
                  touch("breaking_capacity_ka");
                }}
                error={errorFor("breaking_capacity_ka")}
              />
            )}
          </div>
        </Section>
      )}

      {isBarKind(kind) && (
        <Section title={e.terminalGroupsSection}>
          <div
            className="flex flex-col gap-2"
            onBlur={() => {
              touch("terminal_groups");
            }}
          >
            {draft.terminalGroups.map((group, index) => {
              const groupId = `device-group-${String(index)}`;
              const groupLabel = e.terminalGroupNumbered(index + 1);
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
                    onChange={(count) => {
                      setTerminalGroup(index, { count });
                    }}
                  />
                  <NumberField
                    id={`${groupId}-min`}
                    label={f.minMm2}
                    value={group.minMm2}
                    decimal
                    onChange={(minMm2) => {
                      setTerminalGroup(index, { minMm2 });
                    }}
                  />
                  <NumberField
                    id={`${groupId}-max`}
                    label={f.maxMm2}
                    value={group.maxMm2}
                    decimal
                    onChange={(maxMm2) => {
                      setTerminalGroup(index, { maxMm2 });
                    }}
                  />
                  <RemoveButton
                    label={e.removeElement(groupLabel)}
                    text={e.remove}
                    onClick={() => {
                      setDraft((previous) => ({
                        ...previous,
                        terminalGroups: removeAt(previous.terminalGroups, index),
                      }));
                      touch("terminal_groups");
                    }}
                  />
                </div>
              );
            })}
            <IssueList id="device-terminal-groups-error" messages={terminalMessages} />
            <AddButton
              onClick={() => {
                setDraft((previous) => ({
                  ...previous,
                  terminalGroups: [...previous.terminalGroups, newTerminalGroupDraft()],
                }));
              }}
            >
              {e.addTerminalGroup}
            </AddButton>
          </div>
        </Section>
      )}

      <div className="flex flex-col gap-4">
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
            className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
          >
            {submitting ? (
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Save className="size-4" />
            )}
            {submitting ? e.saving : e.save}
          </Button>
          <a
            href={DEVICES_PATH}
            className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/20"
          >
            {e.cancel}
          </a>
        </div>
      </div>
    </form>
  );
}
