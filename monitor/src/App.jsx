import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation, Routes, Route } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'

import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { NotificationProvider } from '@/contexts/NotificationContext'

// Layout components
import ProjectListPage from '@/components/layout/ProjectListPage'
import ProjectView from '@/components/layout/ProjectView'

function App() {
  const navigate = useNavigate()
  const location = useLocation()

  // Truly global state: projects list
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [globalUptime, setGlobalUptime] = useState(0)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  // Dark mode / theme
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system')

  useEffect(() => {
    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.classList.toggle('dark', isDark)
    }
    apply()
    localStorage.setItem('theme', theme)
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  // Register service worker (production only)
  useEffect(() => {
    if ('serviceWorker' in navigator && !import.meta.env.DEV) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  // Open notification center from URL param or SW message
  const [notifCenter, setNotifCenter] = useState(false)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('notif')) {
      setNotifCenter(true)
      navigate('/', { replace: true })
    }
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.action === 'openNotifCenter') setNotifCenter(true)
      })
    }
  }, [])

  const projectToPath = (project) => {
    if (project.repo) return `/github.com/${project.repo}`
    return `/${project.id}`
  }

  const isRootSidebarPath = (pathname) => pathname === '/settings' || pathname === '/notifications'

  const findProjectForPath = (projectList, pathname) => {
    const normalized = pathname.replace(/\/+$/, '') || '/'
    return [...projectList]
      .sort((a, b) => projectToPath(b).length - projectToPath(a).length)
      .find(project => {
        const basePath = projectToPath(project)
        return normalized === basePath || normalized.startsWith(`${basePath}/`)
      }) || null
  }

  const selectProjectFromPath = (projectList) => {
    const path = location.pathname
    if (path === '/' || !path || isRootSidebarPath(path)) return
    const project = findProjectForPath(projectList, path)
    if (project) setSelectedProject(project)
  }

  const prevAgentRef = useRef(null)
  const selectedProjectRef = useRef(null)
  useEffect(() => { selectedProjectRef.current = selectedProject }, [selectedProject])

  // Track callback for agent change notifications
  const onAgentChangeRef = useRef(null)

  const fetchGlobalStatus = async () => {
    try {
      const res = await fetch('/api/status')
      const data = await res.json()
      setGlobalUptime(data.uptime)
      setProjects(data.projects)
      
      if (location.pathname !== '/' && !isRootSidebarPath(location.pathname)) {
        setSelectedProject(prev => {
          if (!prev) return prev
          const updated = data.projects.find(p => p.id === prev.id)
          if (updated) {
            const prevAgent = prevAgentRef.current
            const curAgent = updated.currentAgent || null
            if (prevAgent !== null && prevAgent !== curAgent) {
              // Notify ProjectView that agent changed
              if (onAgentChangeRef.current) onAgentChangeRef.current()
            }
            prevAgentRef.current = curAgent
          }
          return updated || prev
        })
      }
      
      setError(null)
      setLastUpdate(new Date())
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/status')
        const data = await res.json()
        setGlobalUptime(data.uptime)
        setProjects(data.projects)
        setLastUpdate(new Date())
        selectProjectFromPath(data.projects)
      } catch (err) {
        setError(err.message)
      }
    }
    init()
    // Polling as fallback (longer interval since SSE handles real-time)
    const interval = setInterval(fetchGlobalStatus, 30000)

    // SSE for instant status updates
    const evtSource = new EventSource('/api/events')
    evtSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)
        if (event.type === 'status-update' && event.status) {
          setProjects(prev => prev.map(p => p.id === event.project ? event.status : p))
          setSelectedProject(prev => {
            if (!prev || prev.id !== event.project) return prev
            const prevAgent = prevAgentRef.current
            const curAgent = event.status.currentAgent || null
            if (prevAgent !== null && prevAgent !== curAgent) {
              if (onAgentChangeRef.current) onAgentChangeRef.current()
            }
            prevAgentRef.current = curAgent
            return event.status
          })
          setLastUpdate(new Date())
        }
      } catch {}
    }

    return () => {
      clearInterval(interval)
      evtSource.close()
    }
  }, [])

  // Handle browser back/forward
  useEffect(() => {
    if (location.pathname === '/' || isRootSidebarPath(location.pathname)) {
      setSelectedProject(null)
    } else if (!selectedProject) {
      selectProjectFromPath(projects)
    }
  }, [location.pathname, selectedProject, projects])

  const selectProject = (project) => {
    setSelectedProject(project)
    navigate(projectToPath(project))
  }

  const goToProjectList = () => {
    setSelectedProject(null)
    navigate('/')
  }

  // Loading state: URL has a project path but we haven't resolved it yet
  const hasProjectInUrl = location.pathname !== '/' && location.pathname.length > 1 && !isRootSidebarPath(location.pathname)
  if (!selectedProject && hasProjectInUrl && projects.length === 0) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-neutral-400" />
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/" element={
        <ProjectListPage
          projects={projects}
          selectProject={selectProject}
          notifCenter={notifCenter}
          setNotifCenter={setNotifCenter}
          theme={theme}
          setTheme={setTheme}
        />
      }>
        <Route index element={null} />
        <Route path="settings" element={null} />
        <Route path="notifications" element={null} />
      </Route>
      <Route path="*" element={
        <ProjectView
          selectedProject={selectedProject}
          setSelectedProject={setSelectedProject}
          projects={projects}
          selectProject={selectProject}
          goToProjectList={goToProjectList}
          error={error}
          globalUptime={globalUptime}
          fetchGlobalStatus={fetchGlobalStatus}
          notifCenter={notifCenter}
          setNotifCenter={setNotifCenter}
          theme={theme}
          setTheme={setTheme}
          onAgentChangeRef={onAgentChangeRef}
        />
      } />
    </Routes>
  )
}

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('App crashed:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-900">
          <div className="text-center p-8 max-w-md">
            <h1 className="text-lg font-bold text-neutral-800 dark:text-neutral-200 mb-2">Something went wrong</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppWithErrorBoundary() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <NotificationProvider>
            <App />
          </NotificationProvider>
        </ToastProvider>
      </AuthProvider>
    </AppErrorBoundary>
  );
}

export default AppWithErrorBoundary
