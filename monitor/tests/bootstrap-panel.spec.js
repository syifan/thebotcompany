import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

test.describe('Bootstrap panel', () => {
  test('clicking Bootstrap button opens Bootstrap panel', async ({ page }) => {
    await setupMocks(page)
    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
    await expect(bootstrapBtn).toBeVisible({ timeout: 10000 })

    // Wait for the bootstrap API request to complete
    const responsePromise = page.waitForResponse(resp => 
      resp.url().includes(`/api/projects/${PROJECT_REPO}/bootstrap`) && resp.request().method() === 'GET'
    )
    await bootstrapBtn.click()
    await responsePromise

    // Panel should appear
    await expect(page.getByRole('heading', { name: 'Bootstrap Workspace' })).toBeVisible({ timeout: 5000 })
  })

  test('close button closes Bootstrap panel', async ({ page }) => {
    await setupMocks(page)
    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    const bootstrapBtn = page.locator('button[title="Bootstrap project"]')
    await expect(bootstrapBtn).toBeVisible({ timeout: 10000 })

    const responsePromise = page.waitForResponse(resp => 
      resp.url().includes(`/api/projects/${PROJECT_REPO}/bootstrap`) && resp.request().method() === 'GET'
    )
    await bootstrapBtn.click()
    await responsePromise

    await expect(page.getByRole('heading', { name: 'Bootstrap Workspace' })).toBeVisible({ timeout: 5000 })

    // Wait for preview to load and Cancel button to appear, then click it
    const cancelBtn = page.getByRole('button', { name: 'Cancel' })
    await expect(cancelBtn).toBeVisible({ timeout: 5000 })
    await cancelBtn.click()

    await expect(page.getByRole('heading', { name: 'Bootstrap Workspace' })).not.toBeVisible({ timeout: 5000 })
  })
})
