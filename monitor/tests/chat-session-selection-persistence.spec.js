import { test, expect } from '@playwright/test'
import { setupMocks, PROJECT_PATH, PROJECT_REPO } from './helpers.js'

const CHAT_ID = 7
const KEY_ID = 'anthropic-key-1'
const KEY_ID_2 = 'anthropic-key-2'

const KEY_POOL = {
  keys: [
    { id: KEY_ID, label: 'Primary Anthropic', provider: 'anthropic', enabled: true },
    { id: KEY_ID_2, label: 'Backup Anthropic', provider: 'anthropic', enabled: true },
  ],
}

const AVAILABLE_MODELS = {
  anthropic: [
    { id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' },
    { id: 'claude-opus-4-7', name: 'claude-opus-4-7' },
  ],
}

test.describe('Chat session key/model persistence', () => {
  test('restores persisted key/model and saves changes back to the backend', async ({ page }) => {
    await setupMocks(page)

    let savedPreferences = null
    const session = {
      id: CHAT_ID,
      title: 'Persisted chat',
      updated_at: new Date().toISOString(),
      message_count: 2,
      selected_key_id: KEY_ID,
      selected_model: 'claude-sonnet-4-6',
    }

    await page.route(`**/api/projects/${PROJECT_REPO}/config`, route =>
      route.fulfill({
        json: {
          config: { cycleIntervalMs: 0, agentTimeoutMs: 600000, model: 'mid', budgetPer24h: 100 },
          keyPool: KEY_POOL,
          availableModels: AVAILABLE_MODELS,
        },
      })
    )

    await page.route(`**/api/projects/${PROJECT_REPO}/chats`, route =>
      route.fulfill({ json: { sessions: [session] } })
    )

    await page.route(`**/api/projects/${PROJECT_REPO}/chats/${CHAT_ID}`, route =>
      route.fulfill({
        json: {
          session: {
            ...session,
            messages: [
              { role: 'user', content: 'hello' },
              { role: 'assistant', content: 'hi' },
            ],
          },
          streaming: false,
        },
      })
    )

    await page.route(`**/api/projects/${PROJECT_REPO}/chats/${CHAT_ID}/preferences`, async route => {
      savedPreferences = await route.request().postDataJSON()
      session.selected_key_id = savedPreferences.selectedKeyId
      session.selected_model = savedPreferences.selectedModel
      await route.fulfill({ json: { session } })
    })

    await page.goto(`${PROJECT_PATH}/chat/${CHAT_ID}`)
    await page.waitForLoadState('networkidle')

    const keySelect = page.locator('select[aria-label="Key"]').last()
    const modelSelect = page.locator('select[aria-label="Model"]').last()

    await expect(keySelect).toHaveValue(KEY_ID)
    await expect(modelSelect).toHaveValue('claude-sonnet-4-6')

    await keySelect.selectOption(KEY_ID_2)
    await expect.poll(() => savedPreferences).toEqual({
      selectedKeyId: KEY_ID_2,
      selectedModel: 'claude-sonnet-4-6',
    })

    await modelSelect.selectOption('claude-opus-4-7')
    await expect.poll(() => savedPreferences).toEqual({
      selectedKeyId: KEY_ID_2,
      selectedModel: 'claude-opus-4-7',
    })

    await page.reload()
    await page.waitForLoadState('networkidle')

    await expect(page.locator('select[aria-label="Key"]').last()).toHaveValue(KEY_ID_2)
    await expect(page.locator('select[aria-label="Model"]').last()).toHaveValue('claude-opus-4-7')
  })
})
