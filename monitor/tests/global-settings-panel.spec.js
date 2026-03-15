import { test, expect } from '@playwright/test'
import { setupMocks } from './helpers.js'

/**
 * Regression test: Global Settings gear icon should open the Settings panel.
 *
 * The button has no text label, only title="Settings" and a gear icon.
 * If the panel fails to open, this test should fail.
 */

test.describe('Global Settings panel', () => {
  test('gear icon opens Settings panel', async ({ page }) => {
    await setupMocks(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Target the gear icon button specifically via title attribute
    const gearButton = page.locator('button[title="Settings"]')

    await expect(gearButton).toBeVisible({ timeout: 10000 })

    await gearButton.click()

    // The Settings panel header should appear
    const panelHeader = page.getByRole('heading', { name: 'Settings' })

    await expect(panelHeader).toBeVisible({ timeout: 3000 })
  })
})
