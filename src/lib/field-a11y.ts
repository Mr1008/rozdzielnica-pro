/**
 * The accessibility wiring between a form control and its hint or error, for use with the shadcn
 * registry `Field` / `FieldDescription` / `FieldError` (which leave ids to the caller). The ids are
 * `${id}-hint` and `${id}-error`, as in `forms/fields.tsx`, and an error replaces the hint.
 *
 * A plain function, not a wrapper component, because in an `.astro` page a React component's
 * children arrive as pre-rendered HTML — spreading these props onto the control works the same in
 * `.astro` and in React islands:
 *
 *   <Field data-invalid={error ? true : undefined}>
 *     <FieldLabel htmlFor="name">…</FieldLabel>
 *     <Input name="name" {...fieldControlProps("name", { hint, error })} />
 *     {error ? <FieldError id={fieldErrorId("name")}>…</FieldError> : <FieldDescription id={fieldHintId("name")}>…</FieldDescription>}
 *   </Field>
 */

export interface FieldMessages {
  hint?: string;
  error?: string;
}

export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
}

export function fieldHintId(id: string): string {
  return `${id}-hint`;
}

export function fieldErrorId(id: string): string {
  return `${id}-error`;
}

export function fieldControlProps(id: string, { hint, error }: FieldMessages = {}): FieldControlProps {
  return {
    id,
    "aria-describedby": error ? fieldErrorId(id) : hint ? fieldHintId(id) : undefined,
    "aria-invalid": error ? true : undefined,
  };
}
