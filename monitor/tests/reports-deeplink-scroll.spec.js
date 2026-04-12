import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

const MOCK_REPORTS = Array.from({ length: 15 }, (_, i) => ({
  id: `report-${i + 1}`,
  agent: i % 2 === 0 ? 'ares' : 'athena',
  model: 'claude-sonnet-4-6',
  created_at: new Date(Date.now() - (i + 1) * 3600000).toISOString(),
  summary: `Report ${i + 1} summary`,
  body: `Report ${i + 1} body\n\n${'details '.repeat(60)}`,
}))

test.describe('Reports panel deep links', () => {
  test('opening a report URL scrolls that report into view inside the panel', async ({ page }) => {
    await setupMocks(page)

    await page.route(`**/api/projects/${PROJECT_REPO}/reports*`, route =>
      route.fulfill({ json: { reports: MOCK_REPORTS, total: MOCK_REPORTS.length, page: 1, perPage: 20 } })
    )

    await page.goto(`${PROJECT_PATH}/reports/report-15`)
    await page.waitForLoadState('networkidle')

    const panelContent = page.locator('.flex-1.overflow-y-auto.overflow-x-hidden').last()
    await expect(panelContent).toBeVisible({ timeout: 3000 })

    await expect(panelContent.locator('[data-report-id="report-15"]').first()).toBeVisible({ timeout: 5000 })

    const initialScrollTop = await panelContent.evaluate(el => el.scrollTop)
    expect(initialScrollTop).toBeGreaterThan(100)

    await panelContent.evaluate(el => { el.scrollTop = 0 })
    await page.waitForTimeout(2500)

    const scrollTopAfterManualScroll = await panelContent.evaluate(el => el.scrollTop)
    expect(scrollTopAfterManualScroll).toBe(0)
  })
})
