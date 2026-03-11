import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH } from './helpers.js'

test.describe('Live agent log auto-scroll', () => {
  test('auto-scrolls when user is at bottom', async ({ page }) => {
    await setupMocks(page, { withAgent: true })

    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    // Wait for running agent entry in the Agent Reports card
    const runningText = page.getByText('Running... (20 log entries)')
    await expect(runningText).toBeVisible({ timeout: 10000 })

    // Click to open the Reports Panel
    await runningText.click()

    const logBox = page.locator('div.max-h-\\[400px\\]').last()
    await expect(logBox).toBeVisible({ timeout: 3000 })

    // Wait for an agent-log poll to trigger auto-scroll via useEffect
    // (the poll runs every 3s and updates liveAgentLog state)
    await page.waitForTimeout(4000)

    // Verify we're at bottom (auto-scroll behavior)
    const atBottom = await logBox.evaluate(el =>
      el.scrollHeight - el.scrollTop - el.clientHeight < 60
    )
    expect(atBottom).toBe(true)
  })

  test('does not auto-scroll when user has scrolled up', async ({ page }) => {
    await setupMocks(page, { withAgent: true })

    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    const runningText = page.getByText('Running... (20 log entries)')
    await expect(runningText).toBeVisible({ timeout: 10000 })
    await runningText.click()

    const logBox = page.locator('div.max-h-\\[400px\\]').last()
    await expect(logBox).toBeVisible({ timeout: 3000 })

    // Wait for initial auto-scroll
    await page.waitForTimeout(4000)

    // Scroll up manually
    await logBox.evaluate(el => { el.scrollTop = 0 })
    await page.waitForTimeout(300)

    // Verify we're at the top
    const scrollTop = await logBox.evaluate(el => el.scrollTop)
    expect(scrollTop).toBe(0)
  })
})
