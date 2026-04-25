import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_REPO, PROJECT_ID } from './helpers.js'

/**
 * Bug: When a project is pinned to a disabled API key, the Project Settings
 * dropdown shows "Use global default" instead of warning the pinned key is
 * disabled. Model overrides also remain visible because selectedKeyId is
 * still truthy from the stale config.
 *
 * These tests intentionally fail until the bug is fixed.
 */

const DISABLED_KEY = {
  id: 'dead-key-001',
  label: 'DisabledKey',
  provider: 'anthropic',
  type: 'api_key',
  preview: 'sk-ant-...xxxx',
  enabled: false,
  order: 0,
  rateLimited: false,
  cooldownMs: 0,
  createdAt: '2026-01-01T00:00:00Z',
}

const ENABLED_KEY = {
  id: 'good-key-002',
  label: 'WorkingKey',
  provider: 'anthropic',
  type: 'api_key',
  preview: 'sk-ant-...yyyy',
  enabled: true,
  order: 1,
  rateLimited: false,
  cooldownMs: 0,
  createdAt: '2026-01-01T00:00:00Z',
}

test.describe('Project pinned to disabled key', () => {
  test('shows warning when pinned key is disabled', async ({ page }) => {
    await setupMocks(page)

    // Mock key pool with one disabled, one enabled
    await page.route('**/api/keys', route =>
      route.fulfill({ json: { keys: [DISABLED_KEY, ENABLED_KEY], allowCustomProvider: false } })
    )

    // Mock project routes not covered by setupMocks
    const projBase = `**/api/projects/${PROJECT_REPO}`
    await page.route(`${projBase}/chats`, route =>
      route.fulfill({ json: { sessions: [] } })
    )

    // Mock project config: pinned to the disabled key with fallback=false
    await page.route(`${projBase}/config`, route =>
      route.fulfill({
        json: {
          config: { cycleIntervalMs: 0, agentTimeoutMs: 600000, model: 'mid', budgetPer24h: 100 },
          keySelection: { keyId: DISABLED_KEY.id, fallback: false },
          provider: 'anthropic',
          tiers: {},
          allTiers: {},
          availableModels: {},
          keyPool: { keys: [DISABLED_KEY, ENABLED_KEY] },
        }
      })
    )

    await page.goto(`/github.com/${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    // Open project settings
    const settingsButton = page.locator('button[title="Project Settings"]')
    await settingsButton.waitFor({ timeout: 10000 })
    await settingsButton.click()

    // Wait for panel to open (desktop portal)
    const panelHeading = page.getByRole('heading', { name: 'Project Settings' })
    await expect(panelHeading).toBeVisible({ timeout: 5000 })

    // There should be a warning visible about the disabled key
    // Use .last() to get the desktop portal copy (mobile overlay is first but hidden)
    const warning = page.getByText('Selected key is disabled').last()
    await expect(warning).toBeVisible({ timeout: 5000 })
  })

  test('hides model overrides when pinned key is disabled', async ({ page }) => {
    await setupMocks(page)

    await page.route('**/api/keys', route =>
      route.fulfill({ json: { keys: [DISABLED_KEY, ENABLED_KEY], allowCustomProvider: false } })
    )

    const projBase = `**/api/projects/${PROJECT_REPO}`
    await page.route(`${projBase}/chats`, route =>
      route.fulfill({ json: { sessions: [] } })
    )
    await page.route(`${projBase}/config`, route =>
      route.fulfill({
        json: {
          config: {
            cycleIntervalMs: 0,
            agentTimeoutMs: 600000,
            model: 'mid',
            budgetPer24h: 100,
            models: { high: 'claude-opus-4-7', mid: 'claude-sonnet-4-6' },
          },
          keySelection: { keyId: DISABLED_KEY.id, fallback: false },
          provider: 'anthropic',
          tiers: {},
          allTiers: {},
          availableModels: {},
          keyPool: { keys: [DISABLED_KEY, ENABLED_KEY] },
        }
      })
    )

    await page.goto(`/github.com/${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    const settingsButton = page.locator('button[title="Project Settings"]')
    await settingsButton.waitFor({ timeout: 10000 })
    await settingsButton.click()

    // Model overrides should NOT be visible when pinned to a disabled key
    const modelOverridesHeading = page.getByRole('heading', { name: 'Model Overrides' })
    const highTier = page.getByText('HIGH')

    // Either the Model Overrides section should be hidden, or it should show the
    // "select a specific API key" explanation instead of the tier selects
    await expect(modelOverridesHeading).toBeVisible({ timeout: 5000 })
    await expect(highTier).not.toBeVisible({ timeout: 3000 })
  })

  test('dropdown shows disabled key as selected (not global default)', async ({ page }) => {
    await setupMocks(page)

    await page.route('**/api/keys', route =>
      route.fulfill({ json: { keys: [DISABLED_KEY, ENABLED_KEY], allowCustomProvider: false } })
    )

    const projBase = `**/api/projects/${PROJECT_REPO}`
    await page.route(`${projBase}/chats`, route =>
      route.fulfill({ json: { sessions: [] } })
    )
    await page.route(`${projBase}/config`, route =>
      route.fulfill({
        json: {
          config: { cycleIntervalMs: 0, agentTimeoutMs: 600000, model: 'mid', budgetPer24h: 100 },
          keySelection: { keyId: DISABLED_KEY.id, fallback: false },
          provider: 'anthropic',
          tiers: {},
          allTiers: {},
          availableModels: {},
          keyPool: { keys: [DISABLED_KEY, ENABLED_KEY] },
        }
      })
    )

    await page.goto(`/github.com/${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    const settingsButton = page.locator('button[title="Project Settings"]')
    await settingsButton.waitFor({ timeout: 10000 })
    await settingsButton.click()

    // Wait for panel to open
    await expect(page.getByRole('heading', { name: 'Project Settings' })).toBeVisible({ timeout: 5000 })

    // Find the select that has the DisabledKey option (use .last() for desktop portal)
    const select = page.locator('select').filter({ has: page.locator('option', { hasText: 'DisabledKey' }) }).last()
    await expect(select).toBeVisible({ timeout: 5000 })

    // The selected option text should reference the disabled key, not "Use global default"
    const selectedText = await select.evaluate(el => el.options[el.selectedIndex]?.text || '')
    expect(selectedText).toContain('DisabledKey')
  })

  test('clears model overrides when switching from fixed key to global default', async ({ page }) => {
    await setupMocks(page)

    let savedModelsBody = null

    await page.route('**/api/keys', route =>
      route.fulfill({ json: { keys: [ENABLED_KEY], allowCustomProvider: false } })
    )

    const projBase = `**/api/projects/${PROJECT_REPO}`
    await page.route(`${projBase}/chats`, route =>
      route.fulfill({ json: { sessions: [] } })
    )
    await page.route(`${projBase}/config`, route =>
      route.fulfill({
        json: {
          config: {
            cycleIntervalMs: 0,
            agentTimeoutMs: 600000,
            model: 'mid',
            budgetPer24h: 100,
            models: { high: 'claude-opus-4-7', mid: 'claude-sonnet-4-6' },
          },
          keySelection: { keyId: ENABLED_KEY.id, fallback: false },
          provider: 'anthropic',
          tiers: { high: 'claude-opus-4-7', mid: 'claude-sonnet-4-6' },
          allTiers: { anthropic: { high: 'claude-opus-4-7', mid: 'claude-sonnet-4-6' } },
          availableModels: { anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6'] },
          keyPool: { keys: [ENABLED_KEY] },
        }
      })
    )
    await page.route(`${projBase}/token`, async route => {
      await route.request().postDataJSON()
      await route.fulfill({ json: { keySelection: null } })
    })
    await page.route(`${projBase}/models`, async route => {
      savedModelsBody = await route.request().postDataJSON()
      await route.fulfill({
        json: {
          config: {
            cycleIntervalMs: 0,
            agentTimeoutMs: 600000,
            model: 'mid',
            budgetPer24h: 100,
            models: {},
          }
        }
      })
    })

    await page.goto(`/github.com/${PROJECT_ID}`)
    await page.waitForLoadState('networkidle')

    const settingsButton = page.locator('button[title="Project Settings"]')
    await settingsButton.waitFor({ timeout: 10000 })
    await settingsButton.click()

    await expect(page.getByRole('heading', { name: 'Project Settings' })).toBeVisible({ timeout: 5000 })

    const select = page.locator('select').filter({ has: page.locator('option', { hasText: 'WorkingKey' }) }).last()
    await expect(select).toBeVisible({ timeout: 5000 })
    await select.selectOption('')

    await expect.poll(() => savedModelsBody).not.toBeNull()
    expect(savedModelsBody).toEqual({ models: {} })
  })
})
