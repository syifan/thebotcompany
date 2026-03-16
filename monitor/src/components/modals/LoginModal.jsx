import React from 'react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

export default function LoginModal({ open, onClose, loginInput, setLoginInput, handleLogin }) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        Unlock Write Mode
      </ModalHeader>
      <ModalContent>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">Enter password to enable write operations.</p>
        <div className="flex gap-2">
          <input
            type="password"
            className="flex-1 text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 text-neutral-800 dark:text-neutral-100"
            placeholder="Password"
            value={loginInput}
            onChange={(e) => setLoginInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            autoFocus
          />
          <Button onClick={handleLogin} disabled={!loginInput}>Unlock</Button>
        </div>
      </ModalContent>
    </Modal>
  )
}
