"use client";

import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type InputSchema, validateParameters } from "@/src/shared/negotiation-input";

export function initialSellerParameters(schema: InputSchema): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema.properties ?? {}).flatMap<[string, unknown]>(([key, child]) => {
    if (child.const !== undefined) return [[key, child.const]];
    if (child.type === "object" && schema.required?.includes(key)) return [[key, initialSellerParameters(child)]];
    return [];
  }));
}

export function SellerParameters({ schema, value, onChange, disabled = false, showErrors = false, prefix = "seller" }: {
  schema: InputSchema; value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void;
  disabled?: boolean; showErrors?: boolean; prefix?: string;
}) {
  return <FieldGroup>
    {Object.entries(schema.properties ?? {}).map(([key, field]) => {
      const id = `${prefix}-${key}`;
      const required = schema.required?.includes(key) ?? false;
      const invalid = showErrors && ((required && value[key] === undefined) || (value[key] !== undefined && !validateParameters(field, value[key])));
      const update = (next: unknown) => {
        const result = { ...value };
        if (next === undefined) delete result[key]; else result[key] = next;
        onChange(result);
      };
      if (field.type === "object") return <fieldset key={key} disabled={disabled} className="min-w-0 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{field.title ?? key}</legend>
        <SellerParameters schema={field} value={(value[key] ?? {}) as Record<string, unknown>} onChange={update} disabled={disabled} showErrors={showErrors} prefix={id} />
      </fieldset>;
      return <Field key={key} data-invalid={invalid} data-disabled={disabled}>
        <FieldLabel htmlFor={id}>{field.title ?? key}{required ? " *" : ""}</FieldLabel>
        {field.const !== undefined ? <Input id={id} readOnly value={String(field.const)} />
          : field.enum ? <Select value={value[key] === undefined ? "" : `option-${field.enum.indexOf(value[key] as never)}`} onValueChange={selected => update(field.enum![Number(selected.slice(7))])} disabled={disabled}>
            <SelectTrigger id={id} aria-invalid={invalid}><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent><SelectGroup>{field.enum.map((item, index) => <SelectItem key={index} value={`option-${index}`}>{String(item) || "Empty value"}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          : field.type === "boolean" ? <Checkbox id={id} checked={value[key] === true} onCheckedChange={checked => update(checked === true)} disabled={disabled} aria-invalid={invalid} />
          : <Input id={id} value={value[key] === undefined ? "" : String(value[key])} disabled={disabled} required={required} aria-invalid={invalid}
            type={field.type === "string" ? "text" : "number"} step={field.type === "integer" ? 1 : "any"}
            min={field.minimum} max={field.maximum} minLength={field.minLength} maxLength={field.maxLength ?? 1500}
            onChange={event => update(event.target.value === "" ? undefined : field.type === "string" ? event.target.value : Number(event.target.value))} />}
        {field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
        {invalid ? <p className="text-sm text-destructive">Check this value.</p> : null}
      </Field>;
    })}
  </FieldGroup>;
}
