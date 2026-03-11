/**
 * Regression test: browsing older reports in the Agent Reports panel
 * should NOT auto-scroll back to top when the live agent log updates.
 *
 * Root cause: the live log's scroll-anchor ref callback (line ~3611 of App.jsx)
 * fires on every re-render triggered by 3-second agent-log polling.
 * When liveLogAtBottomRef.current is true, it calls scrollIntoView()
 * on the anchor div at the bottom of the live log section (top of the panel),
 * yanking the user away from the report they were reading.
 */
import { test, expect } from '@playwright/test'
import { setupMocks, makeLogEntries, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

const MOCK_REPORTS = Array.from({ length: 15 }, (_, i) => ({
  id: `report-${i + 1}`,
  agent: 'ares',
  model: 'claude-sonnet-4-6',
  createdAt: new Date(Date.now() - (i + 1) * 3600000).toISOString(),
  summary: `Report ${i + 1}: Completed task ${i + 1} with changes to multiple files. `.repeat(5),
  type: 'cycle',
}))

test.describe('Reports panel scroll stability', () => {
  test('agent-log poll does not hijack scroll while browsing old reports', async ({ page }) => {
    let agentLogPollCount = 0

    await setupMocks(page, { withAgent: true })

    // Return real reports so the panel has scrollable content
    await page.route(`**/api/projects/${PROJECT_REPO}/reports*`, route =>
      route.fulfill({ json: { reports: MOCK_REPORTS, total: MOCK_REPORTS.length, page: 1, perPage: 20 } })
    )

    // Agent-log poll: returns growing log to trigger re-renders
    await page.route(`**/api/projects/${PROJECT_REPO}/agent-log`, async route => {
      agentLogPollCount++
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          running: true,
          agent: 'ares',
          model: 'claude-sonnet-4-6',
          startTime: new Date(Date.now() - 60000).toISOString(),
          log: makeLogEntries(20 + agentLogPollCount),
        }),
      })
    })

    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    // Open Reports Panel
    const runningText = page.getByText(/Running\.\.\./)
    await expect(runningText.first()).toBeVisible({ timeout: 10000 })
    await runningText.first().click()
    await page.waitForTimeout(500)

    // The PanelContent is the outer scroll container (class includes overflow-y-auto)
    // It sits inside the Panel portal and contains the live log + reports
    // Target the PanelContent div (it has p-4 flex-1 overflow-y-auto)
    const panelContent = page.locator('.flex-1.overflow-y-auto.overflow-x-hidden').last()
    await expect(panelContent).toBeVisible({ timeout: 3000 })

    // The panel should be scrollable (content taller than viewport)
    const panelHeight = await panelContent.evaluate(el => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))
    expect(panelHeight.scrollHeight).toBeGreaterThan(panelHeight.clientHeight)

    // Scroll down to middle of panel (browsing older reports)
    await panelContent.evaluate(el => { el.scrollTop = el.scrollHeight / 2 })
    await page.waitForTimeout(300)

    const scrollBefore = await panelContent.evaluate(el => el.scrollTop)
    expect(scrollBefore).toBeGreaterThan(100)

    // Wait for 2+ agent-log poll cycles (3s each = ~7s)
    const pollsBefore = agentLogPollCount
    await page.waitForTimeout(7000)
    expect(agentLogPollCount).toBeGreaterThan(pollsBefore)

    // Check scroll position after polls
    const scrollAfter = await panelContent.evaluate(el => el.scrollTop)

    // BUG ASSERTION: scroll should be stable while browsing reports
    // If hijacked, scrollAfter will be near 0 (jumped to top)
    // Tolerance: within 5px (allow minor rounding)
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(5)
  })
})
