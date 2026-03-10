import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_ID } from './helpers.js'

const makeLogEntries = (count) =>
  Array.from({ length: count }, (_, i) => ({
    time: Date.now() - (count - i) * 1000,
    msg: `Tool: Bash → echo "step ${i + 1}" # some long command that fills the log box`,
  }))

test.describe('Live agent log auto-scroll', () => {
  test('auto-scrolls to bottom when user is at bottom', async ({ page }) => {
    const { setAgentLog } = await setupMocks(page)

    // Start with 20 log entries so the box is scrollable
    setAgentLog(makeLogEntries(20))

    await page.goto(`/?project=${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    // Open the reports panel (click the live agent entry in sidebar)
    const liveEntry = page.locator('[data-report-id="live"]').first()
    await expect(liveEntry).toBeVisible({ timeout: 8000 })
    await liveEntry.click()

    // Wait for the log box
    const logBox = page.locator('.max-h-\\[400px\\].overflow-y-auto').first()
    await expect(logBox).toBeVisible({ timeout: 3000 })

    // Wait for polling to deliver more entries
    setAgentLog(makeLogEntries(30))
    await page.waitForTimeout(4000) // wait for 3s poll interval + render

    // Should be scrolled to bottom
    const atBottom = await logBox.evaluate(el =>
      el.scrollHeight - el.scrollTop - el.clientHeight < 60
    )
    expect(atBottom).toBe(true)
  })

  test('does not auto-scroll when user has scrolled up', async ({ page }) => {
    const { setAgentLog } = await setupMocks(page)

    setAgentLog(makeLogEntries(30))

    await page.goto(`/?project=${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    const liveEntry = page.locator('[data-report-id="live"]').first()
    await expect(liveEntry).toBeVisible({ timeout: 8000 })
    await liveEntry.click()

    const logBox = page.locator('.max-h-\\[400px\\].overflow-y-auto').first()
    await expect(logBox).toBeVisible({ timeout: 3000 })

    // Wait for initial render and auto-scroll to settle
    await page.waitForTimeout(1000)

    // Scroll up to the top
    await logBox.evaluate(el => { el.scrollTop = 0 })
    const scrollTopBefore = await logBox.evaluate(el => el.scrollTop)
    expect(scrollTopBefore).toBe(0)

    // Deliver more log entries via next poll
    setAgentLog(makeLogEntries(40))
    await page.waitForTimeout(4000)

    // Scroll position should still be near the top (not jumped to bottom)
    const scrollTopAfter = await logBox.evaluate(el => el.scrollTop)
    expect(scrollTopAfter).toBeLessThan(100) // still near top
  })

  test('resumes auto-scroll when user scrolls back to bottom', async ({ page }) => {
    const { setAgentLog } = await setupMocks(page)

    setAgentLog(makeLogEntries(30))

    await page.goto(`/?project=${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    const liveEntry = page.locator('[data-report-id="live"]').first()
    await expect(liveEntry).toBeVisible({ timeout: 8000 })
    await liveEntry.click()

    const logBox = page.locator('.max-h-\\[400px\\].overflow-y-auto').first()
    await expect(logBox).toBeVisible({ timeout: 3000 })
    await page.waitForTimeout(1000)

    // Scroll up
    await logBox.evaluate(el => { el.scrollTop = 0 })

    // Scroll back to bottom manually
    await logBox.evaluate(el => { el.scrollTop = el.scrollHeight })

    // Trigger the onScroll event so the ref updates
    await logBox.dispatchEvent('scroll')
    await page.waitForTimeout(500)

    // Deliver more entries
    setAgentLog(makeLogEntries(40))
    await page.waitForTimeout(4000)

    // Should have auto-scrolled again
    const atBottom = await logBox.evaluate(el =>
      el.scrollHeight - el.scrollTop - el.clientHeight < 60
    )
    expect(atBottom).toBe(true)
  })
})
