import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH } from './helpers.js'

test.describe('Bootstrap panel', () => {
  test('clicking Bootstrap button opens Bootstrap panel, not Settings', async ({ page }) => {
    await setupMocks(page)
    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    // Bootstrap button is only visible in write mode (authenticated: true in mock)
    const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
    await expect(bootstrapBtn).toBeVisible({ timeout: 10000 })
    await bootstrapBtn.click()

    // Bootstrap panel header should appear
    await expect(page.locator('text=Bootstrap Workspace')).toBeVisible({ timeout: 5000 })

    // Settings panel should NOT be visible
    await expect(page.locator('h2:has-text("Settings")')).not.toBeVisible()
  })

  test('close button on Bootstrap panel closes it', async ({ page }) => {
    await setupMocks(page)
    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
    await expect(bootstrapBtn).toBeVisible({ timeout: 10000 })
    await bootstrapBtn.click()

    await expect(page.locator('text=Bootstrap Workspace')).toBeVisible({ timeout: 5000 })

    // Click the X close button in the panel header (SVG close icon button)
    await page.locator('button svg path[d*="M6 18"]').locator('..').locator('..').first().click()

    await expect(page.locator('text=Bootstrap Workspace')).not.toBeVisible({ timeout: 3000 })
  })

  test('Bootstrap panel close button via Cancel button works', async ({ page }) => {
    await setupMocks(page)
    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
    await expect(bootstrapBtn).toBeVisible({ timeout: 10000 })
    await bootstrapBtn.click()

    await expect(page.locator('text=Bootstrap Workspace')).toBeVisible({ timeout: 5000 })

    // Click Cancel inside the panel
    await page.locator('button:has-text("Close"), button:has-text("Cancel")').first().click()

    await expect(page.locator('text=Bootstrap Workspace')).not.toBeVisible({ timeout: 3000 })
  })

  test('Bootstrap panel does not show Settings content (regression)', async ({ page }) => {
    await setupMocks(page)
    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
    await expect(bootstrapBtn).toBeVisible({ timeout: 10000 })

    // Open and close twice — regression for duplicate settingsModal bug
    for (let i = 0; i < 2; i++) {
      await bootstrapBtn.click()
      await expect(page.locator('text=Bootstrap Workspace')).toBeVisible({ timeout: 5000 })
      await page.locator('button:has-text("Close"), button:has-text("Cancel")').first().click()
      await expect(page.locator('text=Bootstrap Workspace')).not.toBeVisible({ timeout: 3000 })
    }

    // Settings panel should never have appeared
    await expect(page.locator('h2:has-text("Settings")')).not.toBeVisible()
  })
})
