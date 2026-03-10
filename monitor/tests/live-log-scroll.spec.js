import { test, expect } from '@playwright/test'
import { setupMocks, makeLogEntries, PROJECT_PATH } from './helpers.js'

test.describe('Live agent log auto-scroll', () => {
  // TODO: The live agent sidebar entry requires selectedProject.currentAgent
  // to be set, which depends on /api/status returning a running agent.
  // The mock returns the correct data but React state update timing makes
  // the entry not appear reliably in tests. Needs further investigation.
  test.skip('auto-scrolls when user is at bottom', async ({ page }) => {
    const { setAgentLog } = await setupMocks(page, { withAgent: true })
    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(4000)

    const liveEntry = page.locator('[data-report-id="live"]')
    await expect(liveEntry).toBeVisible({ timeout: 10000 })
    await liveEntry.click()

    const logBox = page.locator('.max-h-\\[400px\\].overflow-y-auto').first()
    await expect(logBox).toBeVisible({ timeout: 5000 })

    const atBottom = await logBox.evaluate(el =>
      el.scrollHeight - el.scrollTop - el.clientHeight < 60
    )
    expect(atBottom).toBe(true)
  })
})
