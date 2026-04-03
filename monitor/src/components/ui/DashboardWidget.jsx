import * as React from "react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export default function DashboardWidget({ icon: Icon, title, badge, headerRight, headerExtra, children, className, contentClassName }) {
  return (
    <Card className={cn("h-[500px] flex flex-col", className)}>
      <CardHeader className="shrink-0 pb-2">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4" />}
            {title}
            {badge}
          </span>
          {headerRight}
        </CardTitle>
        {headerExtra}
      </CardHeader>
      <CardContent className={cn("flex-1 overflow-y-auto overflow-x-hidden pt-0", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  )
}
