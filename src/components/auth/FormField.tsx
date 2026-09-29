import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { fieldControlProps, fieldErrorId, fieldHintId } from "@/lib/field-a11y";

interface FormFieldProps {
  id: string;
  name?: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  /** Shown under the control while there is no error; an error replaces it. */
  hint?: string;
  icon: ReactNode;
  endContent?: ReactNode;
}

/**
 * A labelled auth input on the shared `Field` / `InputGroup` primitives: the icon as a leading addon,
 * `endContent` (e.g. the password toggle) as a trailing one, and the hint or error wired to the
 * control through `fieldControlProps` (`aria-describedby`, `aria-invalid`).
 */
export function FormField({
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  error,
  hint,
  icon,
  endContent,
}: FormFieldProps) {
  return (
    <Field data-invalid={error ? true : undefined} className="gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupAddon aria-hidden="true">{icon}</InputGroupAddon>
        <InputGroupInput
          name={name ?? id}
          type={type}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          {...fieldControlProps(id, { hint, error })}
        />
        {endContent && <InputGroupAddon align="inline-end">{endContent}</InputGroupAddon>}
      </InputGroup>
      {error ? (
        <FieldError id={fieldErrorId(id)} className="flex items-center gap-1">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </FieldError>
      ) : hint ? (
        <FieldDescription id={fieldHintId(id)}>{hint}</FieldDescription>
      ) : null}
    </Field>
  );
}
