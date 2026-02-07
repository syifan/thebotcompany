import * as React from "react"

function Separator({ className = "", orientation = "horizontal", ...props }) {
  return (
    <div
      role="separator"
      className={`shrink-0 bg-neutral-200 ${
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]"
      } ${className}`}
      {...props}
    />
  )
}

export { Separator }
