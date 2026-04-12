import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

test.describe('Agent detail deep links', () => {
  test('opening an agent URL directly loads the agent details', async ({ page }) => {
    await setupMocks(page)

    await page.route(`**/api/projects/${PROJECT_REPO}/agents/apollo`, route =>
      route.fulfill({
        json: {
          isManager: true,
          model: 'claude-sonnet-4-6',
          skill: 'Apollo Skill Content',
          roleRules: 'Apollo Rules Content',
          everyone: 'Shared Rules Content',
          agentFiles: [],
        },
      })
    )

    await page.goto(`${PROJECT_PATH}/agent/apollo`)
    await page.waitForLoadState('networkidle')

    const panelContent = page.locator('.flex-1.overflow-y-auto.overflow-x-hidden').last()
    await expect(panelContent.getByText('Apollo Skill Content').first()).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: 'apollo' }).last()).toBeVisible({ timeout: 5000 })
  })
})
