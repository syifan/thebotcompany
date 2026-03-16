import React from 'react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'

export default function TimeoutInfoModal({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        Agent Timeout
      </ModalHeader>
      <ModalContent>
        <div className="space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
          <p>The <strong>maximum time</strong> an individual agent is allowed to run before being killed.</p>
          <p>If an agent exceeds this limit, it will be forcefully terminated and the orchestrator moves to the next agent.</p>
          <p><strong>Never</strong> means no timeout — agents run until they complete naturally. Use with caution as stuck agents can block the entire cycle.</p>
        </div>
      </ModalContent>
    </Modal>
  )
}
