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

export type FormFieldType = FormFieldBaseType &
  (
    | { type: "short_text" | "long_text" | "yes_no" | "date" }
    | { type: "number"; min: number | null; max: number | null; integer: boolean }
    | { type: "single_choice" | "multiple_choice"; options: FormOptionType[] }
    | { type: "file"; maxFiles: number }
  );
