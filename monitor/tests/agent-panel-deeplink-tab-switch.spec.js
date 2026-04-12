import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

test.describe('Agent detail deep-link tab switching', () => {
  test('switching from skill to files on a deep-linked agent page stays stable', async ({ page }) => {
    await setupMocks(page)

    await page.route(`**/api/projects/${PROJECT_REPO}/agents/apollo`, route =>
      route.fulfill({
        json: {
          isManager: true,
          model: 'claude-sonnet-4-6',
          skill: 'Apollo Skill Content',
          roleRules: 'Apollo Rules Content',
          everyone: 'Shared Rules Content',
          agentFiles: [
            {
              name: 'apollo-notes.md',
              modified: '2026-04-12T10:00:00.000Z',
              content: 'Apollo Files Content',
            },
          ],
        },
      })
    )

    await page.goto(`${PROJECT_PATH}/agent/apollo`)
    await page.waitForLoadState('networkidle')

    const panelContent = page.locator('.flex-1.overflow-y-auto.overflow-x-hidden').last()
    await expect(panelContent.getByText('Apollo Skill Content').first()).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: 'Files' }).click()

    await expect(page).toHaveURL(/\/agent\/apollo\/files$/)
    await expect(panelContent.getByText('Apollo Files Content').first()).toBeVisible({ timeout: 5000 })

    const sampledPaths = []
    for (let i = 0; i < 6; i++) {
      sampledPaths.push(await page.evaluate(() => window.location.pathname))
      await page.waitForTimeout(500)
    }

    expect(new Set(sampledPaths)).toEqual(new Set([`/github.com/${PROJECT_REPO}/agent/apollo/files`]))
    await expect(panelContent.getByText('Apollo Files Content').first()).toBeVisible()
    await expect(panelContent.getByText('Apollo Skill Content').first()).not.toBeVisible()
  })
})
