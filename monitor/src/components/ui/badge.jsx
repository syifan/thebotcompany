import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-neutral-900 dark:bg-neutral-100 text-neutral-50 dark:text-neutral-900",
        secondary:
          "border-transparent bg-neutral-100 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100",
        outline: "text-neutral-950 dark:text-neutral-50",
        success:
          "border-transparent bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200",
        warning:
          "border-transparent bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({ className, variant, ...props }) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
