import * as React from "react"

const panelRegistry = { count: 0, listeners: new Set() }

function notifyListeners() {
  const isOpen = panelRegistry.count > 0
  panelRegistry.listeners.forEach(fn => fn(isOpen))
}

function usePanelOpen() {
  const [isOpen, setIsOpen] = React.useState(panelRegistry.count > 0)
  React.useEffect(() => {
    panelRegistry.listeners.add(setIsOpen)
    return () => panelRegistry.listeners.delete(setIsOpen)
  }, [])
  return isOpen
}

const PANEL_WIDTH = 'min(35vw, 560px)'

function Panel({ open, onClose, children }) {
  const [visible, setVisible] = React.useState(false)
  const [animate, setAnimate] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      panelRegistry.count++
      notifyListeners()
      setVisible(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimate(true))
      })
    } else {
      setAnimate(false)
      panelRegistry.count = Math.max(0, panelRegistry.count - 1)
      notifyListeners()
      const timer = setTimeout(() => setVisible(false), 300)
      return () => clearTimeout(timer)
    }
  }, [open])

  if (!visible && !open) return null

  return (
    <>
      {/* Mobile: full-screen overlay */}
      <div className="sm:hidden">
        <div className="fixed inset-0 z-50">
          <div
            className={`fixed inset-0 bg-black/50 transition-opacity duration-300 ${animate ? 'opacity-100' : 'opacity-0'}`}
            onClick={onClose}
          />
          <div
            className={`fixed inset-0 bg-white dark:bg-neutral-800 overflow-y-auto overflow-x-hidden transition-transform duration-300 ease-in-out ${
              animate ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            {children}
          </div>
        </div>
      </div>

      {/* Desktop: fixed right panel */}
      <div className="hidden sm:block">
        <div
          className={`fixed top-0 right-0 bottom-0 z-40 border-l border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 overflow-y-auto overflow-x-hidden transition-transform duration-300 ease-in-out ${
            animate ? 'translate-x-0' : 'translate-x-full'
          }`}
          style={{ width: PANEL_WIDTH, minWidth: 380 }}
        >
          {children}
        </div>
      </div>
    </>
  )
}

function PanelHeader({ children, onClose }) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b dark:border-neutral-700 bg-white dark:bg-neutral-800">
      <h2 className="text-lg font-semibold dark:text-neutral-100 flex-1">{children}</h2>
      {onClose && (
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 ml-2 shrink-0">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

function PanelContent({ children }) {
  return <div className="p-4">{children}</div>
}

export { Panel, PanelHeader, PanelContent, usePanelOpen, PANEL_WIDTH }
