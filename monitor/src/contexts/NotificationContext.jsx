import React, { createContext, useState, useEffect, useRef, useCallback, useContext } from 'react'

const NotificationContext = createContext(null)

export function NotificationProvider({ children }) {
  const [notifList, setNotifList] = useState([])
  const [expandedNotifs, setExpandedNotifs] = useState(new Set())
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('tbc_notifications') === 'true')
  const [detailedNotifs, setDetailedNotifs] = useState(() => localStorage.getItem('tbc_detailed_notifs') === 'true')
  const detailedNotifsRef = useRef(detailedNotifs)
  useEffect(() => { detailedNotifsRef.current = detailedNotifs }, [detailedNotifs])

  // Fetch notifications on mount
  useEffect(() => {
    fetch('/api/notifications').then(r => r.json()).then(d => setNotifList(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // SSE connection for real-time notifications
  useEffect(() => {
    if (!notificationsEnabled) return
    const evtSource = new EventSource('/api/events')
    evtSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)
        if (event.type === 'connected') return
        if (event.notification) {
          setNotifList(prev => [event.notification, ...prev].slice(0, 200))
        }
      } catch {}
    }
    return () => evtSource.close()
  }, [notificationsEnabled])

  const subscribeToPush = async () => {
    try {
      const reg = await navigator.serviceWorker.ready
      const res = await fetch('/api/push/vapid-key')
      const { key } = await res.json()
      if (!key) return
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      })
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
    } catch (e) {
      console.warn('Push subscription failed:', e)
    }
  }

  const unsubscribeFromPush = async () => {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
    } catch {}
  }

  const toggleNotifications = useCallback(async () => {
    if (!('Notification' in window) && !('serviceWorker' in navigator)) {
      alert('This browser does not support notifications')
      return
    }
    if (!notificationsEnabled) {
      if ('Notification' in window) {
        const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
        if (perm !== 'granted') {
          alert('Notification permission denied. Please enable in browser settings.')
          return
        }
      }
      localStorage.setItem('tbc_notifications', 'true')
      setNotificationsEnabled(true)
      await subscribeToPush()
    } else {
      localStorage.setItem('tbc_notifications', 'false')
      setNotificationsEnabled(false)
      await unsubscribeFromPush()
    }
  }, [notificationsEnabled])

  // Auto-subscribe on load if notifications were previously enabled
  useEffect(() => {
    if (notificationsEnabled && 'serviceWorker' in navigator) {
      subscribeToPush()
    }
  }, [])

  const markAllRead = useCallback(() => {
    fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {})
    setNotifList(prev => prev.map(n => ({ ...n, read: true })))
  }, [])

  const markRead = useCallback((id) => {
    fetch(`/api/notifications/${id}/read`, { method: 'POST' }).catch(() => {})
    setNotifList(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }, [])

  const toggleNotifExpand = useCallback((id) => {
    setExpandedNotifs(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const unreadCount = notifList.filter(n => !n.read).length

  const value = {
    notifList,
    expandedNotifs,
    notificationsEnabled,
    detailedNotifs,
    setDetailedNotifs,
    toggleNotifications,
    markAllRead,
    markRead,
    toggleNotifExpand,
    unreadCount,
  }

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}
