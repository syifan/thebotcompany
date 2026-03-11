/**
 * Regression test: the live agent log in the Reports panel should
 * auto-scroll to bottom as new log entries arrive from polling.
 *
 * After the scroll-hijack fix (PR #81), auto-scroll uses a useEffect
 * on liveAgentLog instead of scrollIntoView(). This test verifies
 * that the log stays pinned to the bottom as entries grow.
 */
import { test, expect } from '@playwright/test'
import { setupMocks, makeLogEntries, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

test.describe('Live log auto-scroll on poll', () => {
  test('log is scrolled to bottom immediately on panel open', async ({ page }) => {
    await setupMocks(page, { withAgent: true })

    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    // Open Reports Panel
    const runningText = page.getByText(/Running\.\.\./)
    await expect(runningText.first()).toBeVisible({ timeout: 10000 })
    await runningText.first().click()

    const logBox = page.locator('div.max-h-\\[400px\\]').last()
    await expect(logBox).toBeVisible({ timeout: 3000 })

    // Check immediately — no waiting for polls
    await page.waitForTimeout(500) // just let React settle
    const gap = await logBox.evaluate(el =>
      el.scrollHeight - el.scrollTop - el.clientHeight
    )
    console.log('Gap on panel open:', gap)

    // Should be at bottom immediately
    expect(gap).toBeLessThan(60)
  })

  test('log stays pinned to bottom as new entries arrive', async ({ page }) => {
    let pollCount = 0

    await setupMocks(page, { withAgent: true })

    // Agent-log poll returns a growing log each time
    await page.route(`**/api/projects/${PROJECT_REPO}/agent-log`, async route => {
      pollCount++
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          running: true,
          agent: 'ares',
          model: 'claude-sonnet-4-6',
          startTime: new Date(Date.now() - 60000).toISOString(),
          log: makeLogEntries(20 + pollCount * 5),
        }),
      })
    })

    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    // Open Reports Panel
    const runningText = page.getByText(/Running\.\.\./)
    await expect(runningText.first()).toBeVisible({ timeout: 10000 })
    await runningText.first().click()

    const logBox = page.locator('div.max-h-\\[400px\\]').last()
    await expect(logBox).toBeVisible({ timeout: 3000 })

    // Wait for first poll to auto-scroll
    await page.waitForTimeout(4000)

    const pollsBefore = pollCount
    const initialHeight = await logBox.evaluate(el => el.scrollHeight)

    // Wait for 2 more poll cycles
    await page.waitForTimeout(7000)
    expect(pollCount).toBeGreaterThan(pollsBefore)

    // scrollHeight should have grown
    const afterInfo = await logBox.evaluate(el => ({
      scrollHeight: el.scrollHeight,
      gap: el.scrollHeight - el.scrollTop - el.clientHeight,
    }))
    console.log('After polls:', JSON.stringify(afterInfo))
    expect(afterInfo.scrollHeight).toBeGreaterThan(initialHeight)

    // Should still be at bottom
    expect(afterInfo.gap).toBeLessThan(60)
  })
})
