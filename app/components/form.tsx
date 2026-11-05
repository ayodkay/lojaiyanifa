// Form controls for the customer pages: label, hint and error tied to the input (aria-describedby), the error marked
// with aria-invalid. The checkout keeps its own copy (app/routes/checkout.tsx).
import type { ComponentProps, ReactNode } from "react";

import { cx } from "./ui";

export const INPUT_CLASS = "min-h-11 w-full rounded-[var(--radius-control)] border bg-paper px-3";

export function Field({
  name,
  label,
  error,
  hint,
  className,
  id,
  ...input
}: { name: string; label: string; error?: string; hint?: ReactNode } & ComponentProps<"input">) {
  const fieldId = id ?? `f-${name}`;
  const describedBy = [error ? `${fieldId}-erro` : null, hint ? `${fieldId}-dica` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="mb-1 block text-sm">
        {label}
      </label>
      <input
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(INPUT_CLASS, error ? "border-danger" : "border-line-strong")}
        {...input}
      />
      {hint && (
        <p id={`${fieldId}-dica`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-erro`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({ name, error, children, ...input }: { name: string; error?: string; children: ReactNode } & ComponentProps<"input">) {
  const id = `f-${name}`;
  return (
    <div>
      <label htmlFor={id} className="flex gap-3 text-sm">
        <input
          id={id}
          type="checkbox"
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-erro` : undefined}
          className="mt-0.5"
          {...input}
        />
        <span>{children}</span>
      </label>
      {error && (
        <p id={`${id}-erro`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Moves focus to the first field the server flagged, after a rejected submit. */
export function focusFirstError(): void {
  document.querySelector<HTMLElement>('[aria-invalid="true"], [data-form-error]')?.focus();
}
