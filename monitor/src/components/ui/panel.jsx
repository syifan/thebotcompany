import * as React from "react"
import { createPortal } from "react-dom"

// Global panel state
let _activePanelId = null
let _activePanelKey = null
let _renderedKey = null
let _animate = false
const _closers = {}
const _listeners = new Set()

function _notify() {
  _listeners.forEach(fn => fn({}))
}

function _register(key, id, onClose) {
  if (_activePanelKey && _activePanelKey !== key && _closers[_activePanelKey]) {
    const prevClose = _closers[_activePanelKey]
    setTimeout(() => prevClose(), 0)
  }
  _closers[key] = onClose
  _activePanelKey = key
  _activePanelId = id
  _renderedKey = key
  _animate = true
  _notify()
}

function _unregister(key) {
  delete _closers[key]
  if (_activePanelKey === key) {
    _activePanelKey = null
    _activePanelId = null
    _animate = false
    _notify()
    setTimeout(() => {
      if (!_activePanelKey) {
        _renderedKey = null
        _notify()
      }
    }, 300)
  }
}

// Ref to the PanelSlot DOM node
let _slotRef = null
let _slotKey = null

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
  return { activePanelId: _activePanelId, activePanelKey: _activePanelKey, renderedKey: _renderedKey, animate: _animate }
}

/**
 * Panel portals its children into the PanelSlot DOM node.
 */
function Panel({ open, onClose, children, id: propId }) {
  const idRef = React.useRef(propId || Math.random().toString(36).slice(2))
  const id = idRef.current
  const keyRef = React.useRef(Symbol(id))
  const key = keyRef.current
  const onCloseRef = React.useRef(onClose)
  onCloseRef.current = onClose

  const { renderedKey, animate, activePanelKey } = usePanelState()

  React.useEffect(() => {
    if (open) {
      _register(key, id, () => onCloseRef.current?.())
      // Lock body scroll on mobile when panel is open (full-screen overlay)
      const isMobile = window.innerWidth < 768
      if (isMobile) document.body.style.overflow = 'hidden'
    } else {
      _unregister(key)
      if (!_activePanelKey) document.body.style.overflow = ''
    }
  }, [open, id, key])

  React.useEffect(() => {
    return () => {
      _unregister(key)
      if (!_activePanelKey) document.body.style.overflow = ''
    }
  }, [key])

  const isActive = renderedKey === key
  const shouldAnimate = animate && activePanelKey === key

  if (!isActive) return null

  // Mobile: full-screen overlay (rendered in place)
  const mobileOverlay = (
    <div className="md:hidden">
      <div className="fixed inset-0 z-50">
        <div
          className={`fixed inset-0 bg-black/50 transition-opacity duration-300 ${shouldAnimate ? 'opacity-100' : 'opacity-0'}`}
          onClick={onClose}
        />
        <div
          className={`fixed inset-0 bg-white dark:bg-neutral-800 flex flex-col overflow-hidden overscroll-contain transition-transform duration-300 ease-in-out ${
            shouldAnimate ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  )

  // Desktop: portal into PanelSlot
  const desktopContent = _slotRef ? createPortal(
    <div className="hidden md:flex md:flex-col w-full h-full overflow-hidden overscroll-contain">
      {children}
    </div>,
    _slotRef
  ) : null

  return (
    <>
      {mobileOverlay}
      {desktopContent}
    </>
  )
}

/**
 * Place this as a sibling to your main content inside a flex container.
 * Panel content is portaled here on desktop.
 */
function PanelSlot() {
  const ref = React.useRef(null)
  const keyRef = React.useRef(Symbol('panel-slot'))
  const key = keyRef.current
  const { renderedKey, animate, activePanelKey } = usePanelState()
  const shouldAnimate = animate && activePanelKey === renderedKey

  React.useEffect(() => {
    _slotKey = key
    _slotRef = ref.current
    _notify()
    return () => {
      if (_slotKey === key) {
        _slotRef = null
        _slotKey = null
        _notify()
      }
    }
  }, [key])

  return (
    <div
      ref={ref}
      className={`hidden md:block shrink-0 border-l border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 overflow-hidden h-screen sticky top-0 transition-[width] duration-300 ease-in-out ${
        renderedKey && shouldAnimate ? 'w-[min(35vw,560px)] min-w-[380px]' : 'w-0'
      }`}
    />
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

function PanelContent({ children, onScroll }) {
  return <div className="p-4 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain" onScroll={onScroll}>{children}</div>
}

function PanelProvider({ children }) {
  return children
}

function closeAllPanels() {
  if (_activePanelKey && _closers[_activePanelKey]) {
    _closers[_activePanelKey]()
  }
  _activePanelKey = null
  _activePanelId = null
  _renderedKey = null
  _animate = false
  _notify()
}

export { PanelProvider, Panel, PanelSlot, PanelHeader, PanelContent, usePanelOpen, closeAllPanels }
