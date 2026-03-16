import React from 'react'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'

export default function AgentSettingsModal({ agentSettingsModal, setAgentSettingsModal, saveAgentSettings }) {
  return (
    <Modal open={agentSettingsModal.open} onClose={() => setAgentSettingsModal({ ...agentSettingsModal, open: false })}>
      <ModalHeader onClose={() => setAgentSettingsModal({ ...agentSettingsModal, open: false })}>
        <Settings className="w-4 h-4 inline mr-2" />
        <span className="capitalize">{agentSettingsModal.agent?.name}</span> Settings
      </ModalHeader>
      <ModalContent>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-300 mb-1">Model</label>
            <select
              className="w-full px-3 py-2 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded-md text-sm dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={agentSettingsModal.model}
              onChange={(e) => setAgentSettingsModal(prev => ({ ...prev, model: e.target.value }))}
            >
              <option value="">Inherited from global</option>
              <option value="high">⚡ High (deep reasoning)</option>
              <option value="mid">● Mid (default)</option>
              <option value="low">○ Low (fast/cheap)</option>
            </select>
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Leave empty to use the project's default model.</p>
          </div>
          {agentSettingsModal.error && (
            <p className="text-sm text-red-600 dark:text-red-400">{agentSettingsModal.error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAgentSettingsModal({ ...agentSettingsModal, open: false })}>Cancel</Button>
            <Button onClick={saveAgentSettings} disabled={agentSettingsModal.saving}>
              {agentSettingsModal.saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
