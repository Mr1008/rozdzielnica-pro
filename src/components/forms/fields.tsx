import type { ReactNode } from "react";
import { CircleAlert, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The presentational form pieces shared by the admin editors (cabinets, devices). Native inputs
 * styled with Tailwind; every text comes from the caller, which reads it from `t`.
 */

export const inputClass =
  "w-full rounded-lg border bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none";

export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} className="mt-1 flex items-center gap-1 text-xs text-red-300">
      <CircleAlert className="size-3 shrink-0" />
      {message}
    </p>
  );
}

function FieldHelp({ id, error, hint }: { id: string; error?: string; hint?: string }) {
  if (error) return <FieldError id={`${id}-error`} message={error} />;
  if (!hint) return null;
  return (
    <p id={`${id}-hint`} className="mt-1 text-xs text-blue-100/50">
      {hint}
    </p>
  );
}

function describedBy(id: string, error?: string, hint?: string): string | undefined {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

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
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-blue-100/80">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onBlur={onBlur}
        className={cn(
          inputClass,
          error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
        )}
      />
      <FieldHelp id={id} error={error} hint={hint} />
    </div>
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
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-blue-100/80">
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        onChange={(e) => {
          const next = options.find((option) => option === e.target.value);
          if (next !== undefined) onChange(next);
        }}
        className={cn(
          inputClass,
          "[&>option]:text-zinc-900",
          error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
        )}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
      <FieldHelp id={id} error={error} hint={hint} />
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {hint && <p className="mt-1 text-xs text-blue-100/60">{hint}</p>}
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}

const smallButtonClass =
  "rounded-lg border border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white focus-visible:ring-purple-400";

export function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick} className={cn(smallButtonClass, "self-start")}>
      <Plus className="size-4" />
      {children}
    </Button>
  );
}

/** `label` names what is removed (screen readers, tooltip); `text` is the short visible caption. */
export function RemoveButton({ label, text, onClick }: { label: string; text: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={smallButtonClass}
    >
      <Trash2 className="size-4" />
      <span className="sr-only sm:not-sr-only">{text}</span>
    </Button>
  );
}
