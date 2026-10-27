/** The stored shape of a service's form fields (Phase 5.5 spec, 4.1). */
interface FormFieldBaseType {
  id: string;
  label: string;
  helpText: string | null;
  required: boolean;
}

export interface FormOptionType {
  id: string;
  label: string;
}

/** A form field as clients read it: every setting present, `null` where the field's type has none (R8.4). */
export interface FormFieldViewType extends FormFieldBaseType {
  type: FormFieldType["type"];
  min: number | null;
  max: number | null;
  integer: boolean | null;
  options: FormOptionType[] | null;
  maxFiles: number | null;
}

export function fieldView(field: FormFieldType): FormFieldViewType {
  return {
    id: field.id,
    type: field.type,
    label: field.label,
    helpText: field.helpText,
    required: field.required,
    min: field.type === "number" ? field.min : null,
    max: field.type === "number" ? field.max : null,
    integer: field.type === "number" ? field.integer : null,
    options:
      field.type === "single_choice" || field.type === "multiple_choice" ? field.options : null,
    maxFiles: field.type === "file" ? field.maxFiles : null,
  };
}

export type FormFieldType = FormFieldBaseType &
  (
    | { type: "short_text" | "long_text" | "yes_no" | "date" }
    | { type: "number"; min: number | null; max: number | null; integer: boolean }
    | { type: "single_choice" | "multiple_choice"; options: FormOptionType[] }
    | { type: "file"; maxFiles: number }
  );
