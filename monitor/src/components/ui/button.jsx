import * as React from "react"

function Button({ 
  className = "", 
  variant = "default", 
  size = "default", 
  children, 
  ...props 
}) {
  const baseStyles = "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
  
  const variants = {
    default: "bg-neutral-900 text-neutral-50 hover:bg-neutral-800",
    outline: "border border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-900",
    destructive: "bg-red-500 text-white hover:bg-red-600",
    warning: "bg-amber-500 text-white hover:bg-amber-600",
    ghost: "hover:bg-neutral-100 text-neutral-900",
  }
  
  const sizes = {
    default: "h-9 px-4 py-2 text-sm",
    sm: "h-8 px-3 text-xs",
    lg: "h-10 px-6 text-base",
    icon: "h-9 w-9",
  }
  
  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export { Button }
