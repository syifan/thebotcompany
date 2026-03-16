import React from 'react'
import { Button } from '@/components/ui/button'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'

export default function CreateIssueModal({ createIssueModal, setCreateIssueModal, createIssue, agents, modKey }) {
  return (
    <Modal open={createIssueModal.open} onClose={() => setCreateIssueModal(prev => ({ ...prev, open: false }))}>
      <ModalHeader onClose={() => setCreateIssueModal(prev => ({ ...prev, open: false }))}>
        Create Issue
      </ModalHeader>
      <ModalContent>
        <div className="space-y-4">
          {createIssueModal.error && (
            <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm">
              {createIssueModal.error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Title</label>
            <input
              type="text"
              placeholder="Short description of the issue"
              className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
              value={createIssueModal.title}
              onChange={(e) => setCreateIssueModal(prev => ({ ...prev, title: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('create-issue-body')?.focus() } }}
              onFocus={() => setCreateIssueModal(prev => ({ ...prev, focusedField: 'title' }))}
              disabled={createIssueModal.creating}
              autoFocus
            />
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Created as a human issue in the project database</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Description <span className="text-neutral-400 font-normal">{createIssueModal.focusedField === 'title' ? `(optional, Enter to move here)` : '(optional)'}</span></label>
            <textarea
              id="create-issue-body"
              placeholder="Additional details, context, acceptance criteria..."
              className="w-full px-3 py-2 border rounded-md min-h-[100px] bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
              value={createIssueModal.body}
              onChange={(e) => setCreateIssueModal(prev => ({ ...prev, body: e.target.value }))}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') createIssue() }}
              onFocus={() => setCreateIssueModal(prev => ({ ...prev, focusedField: 'body' }))}
              disabled={createIssueModal.creating}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Receiver <span className="text-neutral-400 font-normal">(optional)</span></label>
            <select
              className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
              value={createIssueModal.receiver}
              onChange={(e) => setCreateIssueModal(prev => ({ ...prev, receiver: e.target.value }))}
              disabled={createIssueModal.creating}
            >
              <option value="">None (visible to all)</option>
              {[...agents.managers, ...agents.workers].map(a => (
                <option key={a.name} value={a.name}>{a.name}{a.role ? ` (${a.role})` : ''}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateIssueModal(prev => ({ ...prev, open: false }))}>Cancel</Button>
            <Button onClick={createIssue} disabled={!createIssueModal.title.trim() || createIssueModal.creating}>
              {createIssueModal.creating ? 'Creating...' : createIssueModal.focusedField === 'body' ? `Create (${modKey}+Enter)` : 'Create'}
            </Button>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
