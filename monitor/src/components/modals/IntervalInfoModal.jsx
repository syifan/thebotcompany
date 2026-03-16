import React from 'react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'

export default function IntervalInfoModal({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        Interval
      </ModalHeader>
      <ModalContent>
        <div className="space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
          <p>The <strong>minimum time</strong> between cycles. After all agents complete a cycle, the orchestrator waits at least this long before starting the next cycle.</p>
          <p>If a budget is configured, the actual interval may be longer to stay within the budget limit. The interval acts as a floor — never shorter, but can be longer.</p>
          <p><strong>No delay</strong> means cycles run back-to-back (only useful with budget control).</p>
        </div>
      </ModalContent>
    </Modal>
  )
}
