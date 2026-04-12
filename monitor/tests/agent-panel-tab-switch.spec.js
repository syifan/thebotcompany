import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

test.describe('Agent detail panel tabs', () => {
  test('switching from skill to files stays on files without blinking back', async ({ page }) => {
    await setupMocks(page)

    await page.route(`**/api/projects/${PROJECT_REPO}/agents/ares`, route =>
      route.fulfill({
        json: {
          model: 'claude-sonnet-4-6',
          skill: 'Skill Tab Unique Content',
          roleRules: '',
          everyone: '',
          agentFiles: [
            {
              name: 'notes.md',
              modified: '2026-04-12T10:00:00.000Z',
              content: 'Files Tab Unique Content',
            },
          ],
        },
      })
    )

    await page.goto(PROJECT_PATH)
    await page.waitForLoadState('networkidle')

    await page.locator('button[title="View agent details"]').nth(1).click()
    const panelContent = page.locator('.flex-1.overflow-y-auto.overflow-x-hidden').last()
    await expect(panelContent.getByText('Skill Tab Unique Content').first()).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: 'Files' }).click()

    await expect(page).toHaveURL(/\/agent\/ares\/files$/)
    await expect(panelContent.getByText('Files Tab Unique Content').first()).toBeVisible({ timeout: 5000 })

    await page.waitForTimeout(2500)

    await expect(panelContent.getByText('Files Tab Unique Content').first()).toBeVisible()
    await expect(panelContent.getByText('Skill Tab Unique Content').first()).not.toBeVisible()
  })
})
