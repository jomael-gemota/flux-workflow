import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  children: ReactNode;
}

const VARIANTS = {
  primary: 'bg-blue-600 hover:bg-blue-500 text-white',
  secondary: 'bg-black/6 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 border border-black/10 dark:border-white/15 text-gray-800 dark:text-white',
  ghost: 'hover:bg-black/6 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300',
  danger: 'bg-red-600 hover:bg-red-500 text-white',
};

const SIZES = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3.5 py-1.5 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {children}
    </button>
  );
}
