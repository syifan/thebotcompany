import * as React from "react"

function Avatar({ className = "", children, ...props }) {
  return (
    <div
      className={`relative flex h-8 w-8 shrink-0 overflow-hidden rounded-full ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

function AvatarFallback({ className = "", children, ...props }) {
  return (
    <div
      className={`flex h-full w-full items-center justify-center rounded-full bg-neutral-200 text-neutral-600 text-xs font-medium ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

export { Avatar, AvatarFallback }
