import { Field, Input, Select, Textarea } from "@/components/ui";
import { inputName, type FormDetails, type FormField, type FormSection } from "../loan-forms";

function FieldInput({ f, value }: { f: FormField; value: string }) {
  const name = inputName(f.key);
  switch (f.type) {
    case "select":
      return (
        <Select name={name} defaultValue={value} required={f.required}>
          <option value="">{f.required ? "Choose" : "—"}</option>
          {Object.entries(f.options ?? {}).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      );
    case "textarea":
      return <Textarea name={name} rows={2} maxLength={1000} defaultValue={value} required={f.required} />;
    case "date":
      return <Input name={name} type="date" defaultValue={value} required={f.required} />;
    case "money":
      return <Input name={name} type="number" min="0" step="0.01" defaultValue={value} required={f.required} />;
    case "email":
      return <Input name={name} type="email" defaultValue={value} required={f.required} />;
    case "bvn":
    case "nin":
      return <Input name={name} inputMode="numeric" pattern="\d{11}" maxLength={11} defaultValue={value} required={f.required} />;
    case "account_no":
      return <Input name={name} inputMode="numeric" pattern="\d{10}" maxLength={10} defaultValue={value} required={f.required} />;
    case "phone":
      return <Input name={name} type="tel" defaultValue={value} required={f.required} />;
    default:
      return <Input name={name} maxLength={300} defaultValue={value} required={f.required} />;
  }
}

/** The extra questions on one of Kuun's loan or guarantor forms, as inputs named fd_<key>. */
export function FormDetailsFields({
  sections,
  values = {},
  errors = {},
  columns = 3,
}: {
  sections: FormSection[];
  values?: FormDetails;
  errors?: Record<string, string | undefined>;
  columns?: 2 | 3;
}) {
  const grid = columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  const wide = columns === 3 ? "sm:col-span-3" : "sm:col-span-2";
  return (
    <>
      {sections.map((s) => (
        <fieldset key={s.title} className={`grid gap-4 ${grid}`}>
          <legend className="mb-2 text-sm font-semibold text-zinc-700">{s.title}</legend>
          {s.fields.map((f) => (
            <div key={f.key} className={f.wide ? wide : undefined}>
              <Field label={f.label} error={errors[inputName(f.key)]} hint={f.hint}>
                <FieldInput f={f} value={values[f.key] ?? ""} />
              </Field>
            </div>
          ))}
        </fieldset>
      ))}
    </>
  );
}
