import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH } from './helpers.js'

test.describe('Bootstrap panel', () => {
  test('clicking Bootstrap button opens Bootstrap panel, not Settings', async ({ page }) => {
    await setupMocks(page)
    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
    await expect(bootstrapBtn).toBeVisible({ timeout: 10000 })
    await bootstrapBtn.click()

    await expect(page.locator('h2:has-text("Bootstrap Workspace")').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('h2:has-text("Settings")').first()).not.toBeVisible()
  })

  test('close button on Bootstrap panel closes it', async ({ page }) => {
    await setupMocks(page)
    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
    await expect(bootstrapBtn).toBeVisible({ timeout: 10000 })
    await bootstrapBtn.click()

    await expect(page.locator('h2:has-text("Bootstrap Workspace")').first()).toBeVisible({ timeout: 5000 })

    // Click X close button in panel header
    await page.locator('h2:has-text("Bootstrap Workspace")').first().locator('..').locator('button').first().click()

    await expect(page.locator('h2:has-text("Bootstrap Workspace")').first()).not.toBeVisible({ timeout: 3000 })
  })

  test('Bootstrap panel close button via Cancel works', async ({ page }) => {
    await setupMocks(page)
    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
    await expect(bootstrapBtn).toBeVisible({ timeout: 10000 })
    await bootstrapBtn.click()

    await expect(page.locator('h2:has-text("Bootstrap Workspace")').first()).toBeVisible({ timeout: 5000 })

    await page.locator('button:has-text("Close"), button:has-text("Cancel")').first().click()

    await expect(page.locator('h2:has-text("Bootstrap Workspace")').first()).not.toBeVisible({ timeout: 3000 })
  })

  test('Bootstrap panel does not show Settings (regression)', async ({ page }) => {
    await setupMocks(page)
    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
    await expect(bootstrapBtn).toBeVisible({ timeout: 10000 })

    for (let i = 0; i < 2; i++) {
      await bootstrapBtn.click()
      await expect(page.locator('h2:has-text("Bootstrap Workspace")').first()).toBeVisible({ timeout: 5000 })
      await page.locator('button:has-text("Close"), button:has-text("Cancel")').first().click()
      await expect(page.locator('h2:has-text("Bootstrap Workspace")').first()).not.toBeVisible({ timeout: 3000 })
    }

    await expect(page.locator('h2:has-text("Settings")').first()).not.toBeVisible()
  })
})
