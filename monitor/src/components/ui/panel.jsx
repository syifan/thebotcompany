import * as React from "react"

const PanelContext = React.createContext(null)

function PanelProvider({ children }) {
  const [activePanelId, setActivePanelId] = React.useState(null)
  const [animate, setAnimate] = React.useState(false)
  const [renderedId, setRenderedId] = React.useState(null)
  const closersRef = React.useRef({})
  const activePanelIdRef = React.useRef(null)

  const register = React.useCallback((id, onClose) => {
    const currentId = activePanelIdRef.current
    if (currentId && currentId !== id && closersRef.current[currentId]) {
      // Defer the close to avoid setState during render
      setTimeout(() => closersRef.current[currentId]?.(), 0)
    }
    closersRef.current[id] = onClose
    activePanelIdRef.current = id
    setActivePanelId(id)
  }, [])

  const unregister = React.useCallback((id) => {
    delete closersRef.current[id]
    if (activePanelIdRef.current === id) {
      activePanelIdRef.current = null
      setActivePanelId(null)
    }
  }, [])

  React.useEffect(() => {
    if (activePanelId) {
      setRenderedId(activePanelId)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimate(true))
      })
    } else {
      setAnimate(false)
      const timer = setTimeout(() => setRenderedId(null), 300)
      return () => clearTimeout(timer)
    }
  }, [activePanelId])

  const isOpen = activePanelId !== null

  const value = React.useMemo(() => ({
    activePanelId, renderedId, animate, register, unregister, isOpen
  }), [activePanelId, renderedId, animate, isOpen])

  return (
    <PanelContext.Provider value={value}>
      {children}
    </PanelContext.Provider>
  )
}

function usePanelOpen() {
  const ctx = React.useContext(PanelContext)
  return ctx?.isOpen ?? false
}

function Panel({ open, onClose, children, id: propId }) {
  const ctx = React.useContext(PanelContext)
  const idRef = React.useRef(propId || Math.random().toString(36).slice(2))
  const id = idRef.current
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose

  React.useEffect(() => {
    if (open) {
      ctx?.register(id, () => onCloseRef.current?.())
    } else {
      ctx?.unregister(id)
    }
  }, [open, id])

  React.useEffect(() => {
    return () => ctx?.unregister(id)
  }, [id])

  const isActive = ctx?.renderedId === id
  const shouldAnimate = ctx?.animate && ctx?.activePanelId === id

  if (!isActive) return null

  return (
    <>
      {/* Mobile/tablet: full-screen overlay */}
      <div className="md:hidden">
        <div className="fixed inset-0 z-50">
          <div
            className={`fixed inset-0 bg-black/50 transition-opacity duration-300 ${shouldAnimate ? 'opacity-100' : 'opacity-0'}`}
            onClick={onClose}
          />
          <div
            className={`fixed inset-0 bg-white dark:bg-neutral-800 overflow-y-auto overflow-x-hidden transition-transform duration-300 ease-in-out ${
              shouldAnimate ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            {children}
          </div>
        </div>
      </div>

      {/* Desktop: fixed right panel */}
      <div className="hidden md:block">
        <div
          className={`fixed top-0 right-0 bottom-0 z-40 border-l border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 overflow-y-auto overflow-x-hidden transition-transform duration-300 ease-in-out ${
            shouldAnimate ? 'translate-x-0' : 'translate-x-full'
          }`}
          style={{ width: 'min(35vw, 560px)', minWidth: 380 }}
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

export { PanelProvider, Panel, PanelHeader, PanelContent, usePanelOpen }
