import { FieldError } from "@/components/forms/fields";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { fieldControlProps, fieldErrorId } from "@/lib/field-a11y";

/**
 * A labelled native select over a closed list of typed values — numbers (In, mm²), strings (sides)
 * or `null` ("Bez grupy"). `SelectField` in `forms/fields.tsx` takes string values only, and every
 * circuit select holds its typed value (see `circuit-draft.ts`), so the option value is the value's
 * string form and the change handler maps it back.
 */
export interface Choice<T> {
  value: T;
  label: string;
}

export interface ChoiceFieldProps<T extends string | number | null> {
  id: string;
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
  error?: string;
}

function optionValue(value: string | number | null): string {
  return value === null ? "" : String(value);
}

export function ChoiceField<T extends string | number | null>({
  id,
  label,
  value,
  choices,
  onChange,
  error,
}: ChoiceFieldProps<T>) {
  return (
    <Field data-invalid={error ? true : undefined} className="gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        size="sm"
        value={optionValue(value)}
        {...fieldControlProps(id, { error })}
        onChange={(event) => {
          const next = choices.find((choice) => optionValue(choice.value) === event.target.value);
          if (next !== undefined) onChange(next.value);
        }}
      >
        {choices.map((choice) => (
          <NativeSelectOption key={optionValue(choice.value)} value={optionValue(choice.value)}>
            {choice.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {error && <FieldError id={fieldErrorId(id)} message={error} />}
    </Field>
  );
}
