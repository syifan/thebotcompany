import React from 'react'
import { cn } from '@/lib/utils'

export function SegmentedControl({ value, onChange, options, className = '' }) {
  return (
    <div className={cn('flex w-full items-center gap-1 rounded-full bg-neutral-100/80 dark:bg-neutral-800/80 p-1', className)}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'flex-1 rounded-full px-3 py-1.5 text-sm text-center transition-colors',
              active
                ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm font-medium'
                : 'bg-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedControl
