import * as React from "react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export default function DashboardWidget({ icon: Icon, title, badge, headerRight, headerExtra, children, className, contentClassName, contentOnScroll, footer }) {
  return (
    <Card className={cn("flex flex-col sm:h-[500px]", className)}>
      <CardHeader className="dashboard-widget-header shrink-0 pb-2">
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
      <CardContent
        className={cn("pt-0 sm:flex-1 sm:min-h-0 dashboard-widget-scroll", contentClassName)}
        onScroll={contentOnScroll}
      >
        {children}
      </CardContent>
      {footer}
    </Card>
  )
}
