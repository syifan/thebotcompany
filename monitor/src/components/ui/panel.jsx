import * as React from "react"

function Panel({ open, onClose, children }) {
  const [visible, setVisible] = React.useState(false)
  const [animate, setAnimate] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      setVisible(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimate(true))
      })
    } else {
      setAnimate(false)
      const timer = setTimeout(() => {
        setVisible(false)
        document.body.style.overflow = ''
      }, 300)
      return () => clearTimeout(timer)
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!visible && !open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div
        className={`fixed inset-0 bg-black/50 transition-opacity duration-300 ${animate ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      {/* Mobile: full screen | Desktop: right-side panel */}
      <div
        className={`fixed inset-0 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(42rem,85vw)] bg-white dark:bg-neutral-800 shadow-xl sm:rounded-l-lg overflow-y-auto overflow-x-hidden transition-transform duration-300 ease-in-out ${
          animate ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {children}
      </div>
    </div>
  )
}

function PanelHeader({ children, onClose }) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b dark:border-neutral-700 bg-white dark:bg-neutral-800">
      <h2 className="text-lg font-semibold dark:text-neutral-100 flex-1">{children}</h2>
      {onClose && (
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
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

export { Panel, PanelHeader, PanelContent }
