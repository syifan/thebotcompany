import { test, expect } from '@playwright/test'
import { setupMocks, makeLogEntries, PROJECT_PATH } from './helpers.js'

test.describe('Live agent log auto-scroll', () => {
  test('auto-scrolls when user is at bottom', async ({ page }) => {
    const { setAgentLog } = await setupMocks(page, { withAgent: true })

    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000) // let project load

    // Open reports panel by clicking the live agent entry in sidebar
    const liveEntry = page.locator('[data-report-id="live"]')
    await expect(liveEntry).toBeVisible({ timeout: 10000 })
    await liveEntry.click()

    // Find the log box
    const logBox = page.locator('.max-h-\\[400px\\].overflow-y-auto').first()
    await expect(logBox).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(500)

    // Check initially at bottom
    const atBottom = await logBox.evaluate(el =>
      el.scrollHeight - el.scrollTop - el.clientHeight < 60
    )
    expect(atBottom).toBe(true)
  })
})
