import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_ID, PROJECT_REPO } from './helpers.js'

test.describe('Project navigation', () => {
  test('All Projects button returns from project page to main list', async ({ page }) => {
    await setupMocks(page)

    await page.goto(`/github.com/${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /All Projects/ }).click()

    await expect(page).toHaveURL('/')
    await expect(page.getByText(PROJECT_REPO).first()).toBeVisible({ timeout: 5000 })
  })
})
