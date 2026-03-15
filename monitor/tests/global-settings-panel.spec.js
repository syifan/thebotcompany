import { test, expect } from '@playwright/test'
import { setupMocks } from './helpers.js'

/**
 * Bug: Global Settings panel is not opening when clicking the gear icon
 * on the project list page.
 *
 * This test intentionally fails until the bug is fixed.
 */

test.describe('Global Settings panel', () => {
  test('gear icon should open Settings panel on project list page', async ({ page }) => {
    await setupMocks(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const gearButton = page.locator('button[title="Settings"]')
    await expect(gearButton).toBeVisible({ timeout: 10000 })

    await gearButton.click()

    // Expect Settings panel header to appear
    const panelHeader = page.getByRole('heading', { name: 'Settings' })
    await expect(panelHeader).toBeVisible({ timeout: 3000 })
  })
})
