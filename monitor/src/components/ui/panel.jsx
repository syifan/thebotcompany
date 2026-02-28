import * as React from "react"

// Simple global panel state - no context needed
let _activePanelId = null
let _renderedId = null
let _animate = false
const _closers = {}
const _listeners = new Set()

function _notify() {
  _listeners.forEach(fn => fn({}))
}

function _register(id, onClose) {
  if (_activePanelId && _activePanelId !== id && _closers[_activePanelId]) {
    const prevClose = _closers[_activePanelId]
    setTimeout(() => prevClose(), 0)
  }
  _closers[id] = onClose
  _activePanelId = id
  _renderedId = id
  // Animate after a frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      _animate = true
      _notify()
    })
  })
  _animate = false
  _notify()
}

function _unregister(id) {
  delete _closers[id]
  if (_activePanelId === id) {
    _activePanelId = null
    _animate = false
    _notify()
    setTimeout(() => {
      if (!_activePanelId) {
        _renderedId = null
        _notify()
      }
    }, 300)
  }
}

function usePanelOpen() {
  const [, forceUpdate] = React.useState({})
  React.useEffect(() => {
    _listeners.add(forceUpdate)
    return () => _listeners.delete(forceUpdate)
  }, [])
  return _activePanelId !== null
}

function usePanelState() {
  const [, forceUpdate] = React.useState({})
  React.useEffect(() => {
    _listeners.add(forceUpdate)
    return () => _listeners.delete(forceUpdate)
  }, [])
  return { activePanelId: _activePanelId, renderedId: _renderedId, animate: _animate }
}

function Panel({ open, onClose, children, id: propId }) {
  const idRef = React.useRef(propId || Math.random().toString(36).slice(2))
  const id = idRef.current
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose

  React.useEffect(() => {
    if (open) {
      _register(id, () => onCloseRef.current?.())
    } else {
      _unregister(id)
    }
  }, [open, id])

  React.useEffect(() => {
    return () => _unregister(id)
  }, [id])

  const { renderedId, animate, activePanelId } = usePanelState()

  const isActive = renderedId === id
  const shouldAnimate = animate && activePanelId === id

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

// PanelProvider is now a no-op wrapper for backward compat
function PanelProvider({ children }) {
  return children
}

export { PanelProvider, Panel, PanelHeader, PanelContent, usePanelOpen }
