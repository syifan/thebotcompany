import { test, expect } from '@playwright/test'
import { setupMocks } from './helpers.js'

test.describe('Root page panel switching', () => {
  test('switching from settings to notifications keeps the new panel open', async ({ page }) => {
    await setupMocks(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.locator('button[title="Settings"]').click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('heading', { name: /Settings/ }).last()).toBeVisible({ timeout: 5000 })

    await page.locator('button[title="Notification Center"]').click()

    await expect(page).toHaveURL(/\/notifications$/)
    await expect(page.getByRole('heading', { name: 'Notifications' }).last()).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1500)
    await expect(page.getByRole('heading', { name: 'Notifications' }).last()).toBeVisible()
  })

  test('switching from notifications to settings keeps the new panel open', async ({ page }) => {
    await setupMocks(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await page.locator('button[title="Notification Center"]').click()
    await expect(page).toHaveURL(/\/notifications$/)
    await expect(page.getByRole('heading', { name: 'Notifications' }).last()).toBeVisible({ timeout: 5000 })

    await page.locator('button[title="Settings"]').click()

    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('heading', { name: /Settings/ }).last()).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1500)
    await expect(page.getByRole('heading', { name: /Settings/ }).last()).toBeVisible()
  })
})
