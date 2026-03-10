import { test, expect } from '@playwright/test'
import { setupMocks, makeLogEntries, PROJECT_PATH } from './helpers.js'

// Helper: get the live log scroll container
const getLogBox = (page) => page.locator('.max-h-\\[400px\\].overflow-y-auto').first()

// Helper: check if element is scrolled to bottom
const isAtBottom = (el) =>
  el.evaluate(e => e.scrollHeight - e.scrollTop - e.clientHeight < 60)

test.describe('Live agent log auto-scroll', () => {
  test('auto-scrolls to bottom when user is at bottom', async ({ page }) => {
    const { setAgentLog } = await setupMocks(page, { withAgent: true })

    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    // Open the reports panel by clicking the live agent entry
    const liveEntry = page.locator('[data-report-id="live"]')
    await expect(liveEntry).toBeVisible({ timeout: 10000 })
    await liveEntry.click()

    const logBox = getLogBox(page)
    await expect(logBox).toBeVisible({ timeout: 5000 })

    // Confirm initially at bottom
    expect(await isAtBottom(logBox)).toBe(true)

    // Simulate new log entries arriving via next poll
    setAgentLog(makeLogEntries(40))
    await page.waitForTimeout(4000) // wait for 3s poll + render

    // Should still be at bottom
    expect(await isAtBottom(logBox)).toBe(true)
  })

  test('does not auto-scroll when user has scrolled up', async ({ page }) => {
    const { setAgentLog } = await setupMocks(page, { withAgent: true })

    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    const liveEntry = page.locator('[data-report-id="live"]')
    await expect(liveEntry).toBeVisible({ timeout: 10000 })
    await liveEntry.click()

    const logBox = getLogBox(page)
    await expect(logBox).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(500) // let initial scroll settle

    // Scroll to top
    await logBox.evaluate(el => { el.scrollTop = 0 })
    await logBox.dispatchEvent('scroll') // trigger onScroll handler
    const topBefore = await logBox.evaluate(el => el.scrollTop)
    expect(topBefore).toBe(0)

    // Deliver more entries
    setAgentLog(makeLogEntries(50))
    await page.waitForTimeout(4000)

    // Should still be near the top
    const topAfter = await logBox.evaluate(el => el.scrollTop)
    expect(topAfter).toBeLessThan(100)
  })

  test('resumes auto-scroll after user scrolls back to bottom', async ({ page }) => {
    const { setAgentLog } = await setupMocks(page, { withAgent: true })

    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    const liveEntry = page.locator('[data-report-id="live"]')
    await expect(liveEntry).toBeVisible({ timeout: 10000 })
    await liveEntry.click()

    const logBox = getLogBox(page)
    await expect(logBox).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(500)

    // Scroll up then back to bottom
    await logBox.evaluate(el => { el.scrollTop = 0 })
    await logBox.dispatchEvent('scroll')
    await logBox.evaluate(el => { el.scrollTop = el.scrollHeight })
    await logBox.dispatchEvent('scroll')
    await page.waitForTimeout(200)

    // Deliver more entries
    setAgentLog(makeLogEntries(60))
    await page.waitForTimeout(4000)

    // Should auto-scroll again
    expect(await isAtBottom(logBox)).toBe(true)
  })
})
