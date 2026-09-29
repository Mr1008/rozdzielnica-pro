import type { ReactNode } from "react";
import { CircleAlert, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel, FieldError as RegistryFieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { fieldControlProps, fieldErrorId, fieldHintId } from "@/lib/field-a11y";
import { cn } from "@/lib/utils";

/**
 * The presentational form pieces shared by the admin editors (cabinets, devices), on the registry
 * `Field`, `Input`, `NativeSelect`, `Card` and `Button`. Every text comes from the caller, which
 * reads it from `t`. The hint/error ids and the `aria-invalid`/`aria-describedby` wiring come from
 * `@/lib/field-a11y`, so they match the `.astro` forms.
 */

/**
 * A field's error text. Not an alert: it updates on every keystroke, and the control's
 * `aria-describedby` already points screen readers at it.
 */
export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <RegistryFieldError id={id} role={undefined} className="flex items-start gap-1 text-xs">
      <CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      {message}
    </RegistryFieldError>
  );
}

function FieldHelp({ id, error, hint }: { id: string; error?: string; hint?: string }) {
  if (error) return <FieldError id={fieldErrorId(id)} message={error} />;
  if (!hint) return null;
  return (
    <FieldDescription id={fieldHintId(id)} className="text-xs">
      {hint}
    </FieldDescription>
  );
}

const fieldClass = "gap-1.5";

export interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  name?: string;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal";
}

export function TextField({
  id,
  label,
  value,
  onChange,
  name,
  onBlur,
  error,
  hint,
  placeholder,
  inputMode,
}: TextFieldProps) {
  // Numbers read as figures: mono and tabular, like every other measured value in the app.
  const numeric = inputMode === "numeric" || inputMode === "decimal";
  return (
    <Field data-invalid={error ? true : undefined} className={fieldClass}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        name={name}
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        {...fieldControlProps(id, { hint, error })}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onBlur={onBlur}
        className={cn(numeric && "font-mono tabular-nums")}
      />
      <FieldHelp id={id} error={error} hint={hint} />
    </Field>
  );
}

/** Integers by default; `decimal` for fields that take a fraction (mm², mm with decimals, kA). */
export function NumberField(props: Omit<TextFieldProps, "inputMode"> & { decimal?: boolean }) {
  const { decimal, ...rest } = props;
  return <TextField {...rest} inputMode={decimal ? "decimal" : "numeric"} />;
}

export interface SelectFieldProps<T extends string> {
  id: string;
  label: string;
  /** `""` shows the placeholder option; only meaningful together with `placeholder`. */
  value: T | "";
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
  name?: string;
  placeholder?: string;
  error?: string;
  hint?: string;
}

export function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  labels,
  onChange,
  name,
  placeholder,
  error,
  hint,
}: SelectFieldProps<T>) {
  return (
    <Field data-invalid={error ? true : undefined} className={fieldClass}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        name={name}
        value={value}
        {...fieldControlProps(id, { hint, error })}
        onChange={(e) => {
          const next = options.find((option) => option === e.target.value);
          if (next !== undefined) onChange(next);
        }}
      >
        {placeholder !== undefined && (
          <NativeSelectOption value="" disabled>
            {placeholder}
          </NativeSelectOption>
        )}
        {options.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {labels[option]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <FieldHelp id={id} error={error} hint={hint} />
    </Field>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <Card className="gap-4 py-5">
        <CardHeader className="px-5">
          <h2 className="text-lg leading-none font-semibold">{title}</h2>
          {hint && <CardDescription className="text-xs">{hint}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-5">{children}</CardContent>
      </Card>
    </section>
  );
}

export function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} className="self-start">
      <Plus aria-hidden="true" />
      {children}
    </Button>
  );
}

/** `label` names what is removed (screen readers, tooltip); `text` is the short visible caption. */
export function RemoveButton({ label, text, onClick }: { label: string; text: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick} aria-label={label} title={label}>
      <Trash2 aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{text}</span>
    </Button>
  );
}
