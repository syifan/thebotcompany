import React from 'react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'

export default function BudgetInfoModal({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>
        How Budget Works
      </ModalHeader>
      <ModalContent>
        <div className="space-y-4 text-sm text-neutral-700 dark:text-neutral-300">
          <div>
            <h3 className="font-semibold text-neutral-800 dark:text-neutral-100 mb-1">Overview</h3>
            <p>The budget system dynamically adjusts cycle intervals to keep your 24-hour spending under the configured limit.</p>
          </div>
          
          <div>
            <h3 className="font-semibold text-neutral-800 dark:text-neutral-100 mb-1">How it calculates sleep time</h3>
            <ol className="list-decimal list-inside space-y-1 text-neutral-600 dark:text-neutral-400">
              <li>Tracks cost of each cycle using EMA (exponential moving average)</li>
              <li>Calculates remaining budget: <code className="bg-neutral-100 dark:bg-neutral-800 px-1 rounded">budget - spent_24h</code></li>
              <li>Estimates how many cycles you can afford</li>
              <li>Spreads those cycles evenly across 24 hours</li>
              <li>Adds a conservatism factor that decreases as more data is collected</li>
            </ol>
          </div>

          <div>
            <h3 className="font-semibold text-neutral-800 dark:text-neutral-100 mb-1">Interval as minimum</h3>
            <p>If you set both budget and interval, the <strong>interval acts as a floor</strong>. Budget can make sleep longer, but never shorter than the configured interval.</p>
          </div>

          <div>
            <h3 className="font-semibold text-neutral-800 dark:text-neutral-100 mb-1">Budget exhaustion</h3>
            <p>When spending hits the limit, the orchestrator sleeps until the oldest cost entry rolls off the 24-hour window (max 2 hours at a time).</p>
          </div>

          <div>
            <h3 className="font-semibold text-neutral-800 dark:text-neutral-100 mb-1">Cold start</h3>
            <p>With no historical data, it estimates based on agent count and model type, using a higher conservatism factor.</p>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
