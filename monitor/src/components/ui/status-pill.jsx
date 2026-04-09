import React from 'react'
import { cn } from '@/lib/utils'

const variants = {
  open: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-600/20 dark:text-emerald-300 dark:ring-emerald-500/20',
  merged: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-600/20 dark:text-blue-300 dark:ring-blue-500/20',
  closed: 'bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200 dark:bg-neutral-700 dark:text-neutral-200 dark:ring-neutral-600',
  meta: 'bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700',
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-600/20 dark:text-emerald-300 dark:ring-emerald-500/20',
  warning: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-600/20 dark:text-amber-300 dark:ring-amber-500/20',
  danger: 'bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-600/20 dark:text-red-300 dark:ring-red-500/20',
  info: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-600/20 dark:text-sky-300 dark:ring-sky-500/20',
}

export function StatusPill({ variant = 'meta', children, className = '' }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center justify-center align-middle whitespace-nowrap rounded-full px-3 text-xs leading-none font-medium capitalize overflow-visible',
        variants[variant] || variants.meta,
        className,
      )}
    >
      {children}
    </span>
  )
}

export default StatusPill
