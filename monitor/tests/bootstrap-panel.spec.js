import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_ID } from './helpers.js'

test.describe('Bootstrap panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page)
    await page.goto('/')
    // Select the test project
    await page.waitForSelector(`[data-project-id="${PROJECT_ID}"], button:has-text("thebotcompany")`, { timeout: 5000 })
      .catch(() => {}) // project may auto-select
  })

  test('clicking Bootstrap button opens Bootstrap panel, not Settings', async ({ page }) => {
    // Navigate to project view
    await page.goto(`/?project=${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    // Find and click the Bootstrap button (red button with title "Bootstrap project")
    const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
    await expect(bootstrapBtn).toBeVisible({ timeout: 5000 })
    await bootstrapBtn.click()

    // Bootstrap panel header should appear
    await expect(page.locator('text=Bootstrap Workspace')).toBeVisible({ timeout: 3000 })

    // Settings panel should NOT be visible
    await expect(page.locator('h2:has-text("Settings")')).not.toBeVisible()
  })

  test('close button on Bootstrap panel closes it', async ({ page }) => {
    await page.goto(`/?project=${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
    await expect(bootstrapBtn).toBeVisible({ timeout: 5000 })
    await bootstrapBtn.click()

    // Panel should be open
    await expect(page.locator('text=Bootstrap Workspace')).toBeVisible({ timeout: 3000 })

    // Click the close button in the panel header
    await page.locator('h2:has-text("Bootstrap Workspace") ~ button, [aria-label="Close"], button:near(h2:has-text("Bootstrap Workspace"))').first().click()

    // Panel should be gone
    await expect(page.locator('text=Bootstrap Workspace')).not.toBeVisible({ timeout: 3000 })
  })

  test('Bootstrap panel does not reopen Settings after close', async ({ page }) => {
    await page.goto(`/?project=${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    // Open and close Bootstrap twice — regression for the duplicate settingsModal bug
    for (let i = 0; i < 2; i++) {
      const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
      await bootstrapBtn.click()
      await expect(page.locator('text=Bootstrap Workspace')).toBeVisible({ timeout: 3000 })

      // Close via Cancel/Close button inside panel
      const closeBtn = page.locator('button:has-text("Close"), button:has-text("Cancel")').first()
      await closeBtn.click()
      await expect(page.locator('text=Bootstrap Workspace')).not.toBeVisible({ timeout: 3000 })
    }

    // Settings should never have appeared
    await expect(page.locator('h2:has-text("Settings")')).not.toBeVisible()
  })
})
