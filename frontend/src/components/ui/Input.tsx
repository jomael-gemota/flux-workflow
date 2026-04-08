import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ label, hint, className = '', ...props }, ref) {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
        )}
        <input
          ref={ref}
          {...props}
          className={`w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${className}`}
        />
        {hint && <p className="text-slate-400 dark:text-slate-500 text-[10px]">{hint}</p>}
      </div>
    );
  }
);

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ label, className = '', ...props }, ref) {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
        )}
        <textarea
          ref={ref}
          {...props}
          className={`w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none ${className}`}
        />
      </div>
    );
  }
);

type SelectOption = { value: string; label: string };
type SelectGroup  = { group: string; options: SelectOption[] };

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<SelectOption | SelectGroup>;
}

function isGroup(o: SelectOption | SelectGroup): o is SelectGroup {
  return 'group' in o;
}

export function Select({ label, options, className = '', ...props }: SelectProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
      )}
      <select
        {...props}
        className={`w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${className}`}
      >
        {options.map((o) =>
          isGroup(o) ? (
            <optgroup key={o.group} label={o.group}>
              {o.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </optgroup>
          ) : (
            <option key={o.value} value={o.value}>{o.label}</option>
          )
        )}
      </select>
    </div>
  );
}
