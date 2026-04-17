import { test, expect } from '@playwright/test'
import { setupMocks } from './helpers.js'

test.describe('Break mobile experience toggle', () => {
  test('can be toggled from global settings on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await setupMocks(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const gearButton = page.locator('button[title="Settings"]')
    await expect(gearButton).toBeVisible({ timeout: 10000 })
    await gearButton.click()

    const panelHeader = page.getByRole('heading', { name: 'Settings' })
    await expect(panelHeader).toBeVisible({ timeout: 3000 })

    const toggle = page.getByLabel('Intentionally break mobile experience', { exact: true })
    await expect(toggle).toBeVisible()
    await expect(toggle).not.toBeChecked()

    await toggle.check()

    await expect(toggle).toBeChecked()
    await expect.poll(async () => page.evaluate(() => localStorage.getItem('breakMobileExperience'))).toBe('true')
    await expect.poll(async () => page.locator('meta[name="viewport"]').getAttribute('content')).toBe('width=1024, initial-scale=1')
  })
})
