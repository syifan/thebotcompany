import React from 'react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

export default function DoctorConfirmModal({
  open,
  onClose,
  onConfirm,
  projectId,
  running,
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        Run Doctor
      </ModalHeader>
      <ModalContent>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Doctor will check the workspace layout for <span className="font-mono font-semibold">{projectId}</span> and report any missing paths.
          This is read-only and will not modify files.
        </p>
        <div className="flex items-center justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose} disabled={running}>Cancel</Button>
          <Button variant="warning" onClick={onConfirm} disabled={running}>
            {running ? 'Running...' : 'Run Doctor'}
          </Button>
        </div>
      </ModalContent>
    </Modal>
  )
}
