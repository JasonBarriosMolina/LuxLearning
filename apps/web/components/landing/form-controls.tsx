'use client';

import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { Check } from 'lucide-react';
import { EXCLUSIVE_OPTIONS } from './teacher-application-options';

export const inputCls =
  'mt-2 w-full rounded-xl border bg-lx-paper px-4 py-3 text-base text-lx-ink outline-none transition-colors placeholder:text-lx-soft focus:border-[#3E8FD0] focus:shadow-[0_0_0_4px_rgba(62,143,208,0.18)]';

export function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-[#B42318]">
      {error}
    </p>
  );
}

function Label({ htmlFor, children, optional }: { htmlFor?: string; children: ReactNode; optional?: boolean }) {
  const Tag = htmlFor ? 'label' : 'p';
  return (
    <Tag {...(htmlFor ? { htmlFor } : {})} className="text-sm font-bold text-lx-navy">
      {children}
      {optional && <span className="font-medium text-lx-soft"> (opcional)</span>}
    </Tag>
  );
}

type Common = { id: string; label: string; error?: string; optional?: boolean; hint?: string };

export function TextField({ id, label, error, optional, hint, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <Label htmlFor={id} optional={optional}>{label}</Label>
      {hint && <p className="mt-1 text-sm text-lx-muted">{hint}</p>}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${inputCls} ${error ? 'border-[#F04438]' : 'border-lx-line'}`}
        {...rest}
      />
      <FieldError id={id} error={error} />
    </div>
  );
}

export function TextAreaField({ id, label, error, optional, hint, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div>
      <Label htmlFor={id} optional={optional}>{label}</Label>
      {hint && <p className="mt-1 text-sm text-lx-muted">{hint}</p>}
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${inputCls} ${error ? 'border-[#F04438]' : 'border-lx-line'}`}
        {...rest}
      />
      <FieldError id={id} error={error} />
    </div>
  );
}

/** Single or multiple choice shown as tappable chips (radio / checkbox semantics). */
export function ChoiceField({ id, label, error, hint, options, value, onChange, multiple = false }: Common & {
  options: readonly string[];
  value: string | string[];
  onChange: (next: string | string[]) => void;
  multiple?: boolean;
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];

  const toggle = (option: string) => {
    if (!multiple) return onChange(option);
    if (selected.includes(option)) return onChange(selected.filter((o) => o !== option));
    if (EXCLUSIVE_OPTIONS.includes(option)) return onChange([option]);
    return onChange([...selected.filter((o) => !EXCLUSIVE_OPTIONS.includes(o)), option]);
  };

  return (
    <fieldset aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="text-sm font-bold text-lx-navy">
        {label}
        {multiple && <span className="font-medium text-lx-soft"> (puedes elegir varias)</span>}
      </legend>
      {hint && <p className="mt-1 text-sm text-lx-muted">{hint}</p>}
      <div id={id} tabIndex={-1} className="mt-3 flex flex-wrap gap-2 outline-none">
        {options.map((option) => {
          const on = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              role={multiple ? 'checkbox' : 'radio'}
              aria-checked={on}
              onClick={() => toggle(option)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
                on
                  ? 'bg-[linear-gradient(135deg,#2F8FDB,#17527E)] text-white shadow-[0_8px_20px_-12px_rgba(23,82,126,0.9)]'
                  : 'bg-lx-paper text-lx-navy ring-1 ring-lx-line hover:ring-[#3E8FD0]'
              }`}
            >
              {on && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
              {option}
            </button>
          );
        })}
      </div>
      <FieldError id={id} error={error} />
    </fieldset>
  );
}
