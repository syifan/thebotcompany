import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

test('browser back returns from project page to main list', async ({ page }) => {
  await setupMocks(page)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.getByText(PROJECT_REPO).first().click()
  await expect(page).toHaveURL(PROJECT_PATH)

  await page.evaluate(() => window.history.back())

  await expect(page).toHaveURL('/')
  await expect(page.getByText(PROJECT_REPO).first()).toBeVisible({ timeout: 5000 })
})
