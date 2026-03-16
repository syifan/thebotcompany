import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation, Routes, Route } from 'react-router-dom'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Activity, Users, Sparkles, Settings, ScrollText, RefreshCw, Pause, Play, SkipForward, RotateCcw, Square, Save, MessageSquare, X, GitPullRequest, CircleDot, Clock, User, UserCheck, Folder, Plus, Trash2, ArrowLeft, Github, DollarSign, Sun, Moon, Monitor, Filter, Info, ChevronDown, Lock, Unlock, Bell, BellOff } from 'lucide-react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'

import ReactMarkdown from 'react-markdown'
import ScheduleDiagram, { parseScheduleBlock, stripAllMetaBlocks, parseTimingBlock, MetaBlockBadges, getAgentTask } from '@/components/ScheduleDiagram'
import remarkGfm from 'remark-gfm'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { detectProvider } from '@/utils'

// Layout components
import Footer from '@/components/layout/Footer'
import SleepCountdown from '@/components/layout/SleepCountdown'
import LiveDuration from '@/components/layout/LiveDuration'
import ProjectListPage from '@/components/layout/ProjectListPage'
import ProjectView from '@/components/layout/ProjectView'

// Panel components
import SettingsPanel from '@/components/panels/SettingsPanel'
import NotificationPanel from '@/components/panels/NotificationPanel'
import BootstrapPanel from '@/components/panels/BootstrapPanel'
import ReportsPanel from '@/components/panels/ReportsPanel'

// Modal components
import LoginModal from '@/components/modals/LoginModal'
import AddProjectModal from '@/components/modals/AddProjectModal'
import ApiKeyHelpModal from '@/components/modals/ApiKeyHelpModal'

// Project components
import { OrchestratorStateCard, CostBudgetCard, ConfigCard } from '@/components/project/OrchestratorState'
import WorkerCard from '@/components/project/WorkerCard'
import IssuesSidebar from '@/components/project/IssuesSidebar'
import AgentReportsCard from '@/components/project/AgentReportsCard'

// Lazy report summary component — triggers summarization on first render if missing
const summaryCache = new Map() // reportId -> summary string | 'loading' | 'error'

function ReportSummary({ reportId, projectId, summary: initialSummary, className }) {
  const [summary, setSummary] = useState(initialSummary || summaryCache.get(reportId) || null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (summary || loading || summaryCache.get(reportId) === 'loading') return
    if (summaryCache.get(reportId) === 'error') return
    const cached = summaryCache.get(reportId)
    if (cached && cached !== 'loading' && cached !== 'error') { setSummary(cached); return }

    summaryCache.set(reportId, 'loading')
    setLoading(true)
    fetch(`/api/projects/${projectId}/reports/${reportId}/summarize`, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.summary) {
          summaryCache.set(reportId, data.summary)
          setSummary(data.summary)
        } else {
          summaryCache.set(reportId, 'error')
        }
      })
      .catch(() => summaryCache.set(reportId, 'error'))
      .finally(() => setLoading(false))
  }, [reportId, projectId, summary, loading])

  if (!summary && !loading) return null
  return (
    <span className={className || "text-xs text-neutral-500 dark:text-neutral-400 italic"}>
      {loading ? '…' : summary}
    </span>
  )
}

function App() {
  const navigate = useNavigate()
  const location = useLocation()

  // Multi-project state
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [globalUptime, setGlobalUptime] = useState(0)
  const [addProjectModal, setAddProjectModal] = useState({
    step: null, githubUrl: '', projectId: null, projectPath: null,
    hasSpec: false, specContent: null, whatToBuild: '', successCriteria: '',
    updateSpec: false, budgetPer24h: 40, error: null,
    orgs: [], repos: [], selectedOrg: '', selectedRepo: '', orgsLoading: false, reposLoading: false,
    inputMode: 'dropdown', // 'dropdown' or 'url'
    repoMode: 'existing', // 'existing' or 'new'
    newRepoName: '', newRepoPrivate: false, newRepoDescription: '', creatingRepo: false,
  })
  
  // Project-specific state
  const [logs, setLogs] = useState([])
  const [agents, setAgents] = useState({ workers: [], managers: [] })
  const [config, setConfig] = useState({ config: null, raw: '' })
  const [hasProjectToken, setHasProjectToken] = useState(false)
  const [projectTokenPreview, setProjectTokenPreview] = useState(null)
  const [projectTokenProviderLabel, setProjectTokenProviderLabel] = useState(null)
  const [projectTokenInput, setProjectTokenInput] = useState('')
  const [projectTokenProvider, setProjectTokenProvider] = useState('')
  const [projectTokenSaving, setProjectTokenSaving] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [projectNotifs, setProjectNotifs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tbc_project_notifs') || '{}') } catch { return {} }
  })
  const [configForm, setConfigForm] = useState({
    cycleIntervalMs: 1800000, agentTimeoutMs: 900000,
    trackerIssue: 1, budgetPer24h: 0
  })
  const [configDirty, setConfigDirty] = useState(false)
  const configDirtyRef = useRef(false)
  const [configError, setConfigError] = useState(null)
  const [configSaving, setConfigSaving] = useState(false)
  const [repoUrl, setRepoUrl] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [error, setError] = useState(null)
  const [comments, setComments] = useState([])
  const [commentsPage, setCommentsPage] = useState(1)
  const [commentsHasMore, setCommentsHasMore] = useState(true)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState(() => localStorage.getItem('selectedAgent') || null)
  const [prs, setPrs] = useState([])
  const [issues, setIssues] = useState([])
  const [issueFilter, setIssueFilter] = useState('open') // 'open' | 'closed' | 'all'
  const [createIssueModal, setCreateIssueModal] = useState({ open: false, title: '', body: '', receiver: '', creating: false, error: null, focusedField: 'title' })
  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'
  const [agentModal, setAgentModal] = useState({ open: false, agent: null, data: null, loading: false, tab: 'skill' })
  const [issueModal, setIssueModal] = useState({ open: false, issue: null, comments: [], loading: false })
  const [bootstrapModal, setBootstrapModal] = useState({ open: false, loading: false, preview: null, error: null, executing: false, removeRoadmap: true, specMode: 'keep', specContent: '', whatToBuild: '', successCriteria: '' })
  const [authPassword, setAuthPassword] = useState(() => localStorage.getItem('tbc_password') || '')
  const [isWriteMode, setIsWriteMode] = useState(false)
  const [loginModal, setLoginModal] = useState(false)
  const [loginInput, setLoginInput] = useState('')
  const [budgetInfoModal, setBudgetInfoModal] = useState(false)
  const [showApiKeyHelp, setShowApiKeyHelp] = useState(false)
  const [codexLoginState, setCodexLoginState] = useState(null) // null | 'polling' | 'waiting' | 'success' | 'error'
  const [projectCodexLoginState, setProjectCodexLoginState] = useState(null)
  const [liveAgentLog, setLiveAgentLog] = useState(null) // { agent, model, startTime, log: [{time, msg}] }

  // Check codex auth status on mount (global)
  useEffect(() => {
    fetch('/api/openai-codex/status').then(r => r.json()).then(d => {
      if (d.authenticated) setCodexLoginState('success')
    }).catch(() => {})
  }, [])

  // Check project-level codex auth when project changes
  useEffect(() => {
    if (selectedProject?.id) {
      fetch(`/api/openai-codex/status?project=${encodeURIComponent(selectedProject.id)}`).then(r => r.json()).then(d => {
        setProjectCodexLoginState(d.authenticated ? 'success' : null)
      }).catch(() => setProjectCodexLoginState(null))
    } else {
      setProjectCodexLoginState(null)
    }
  }, [selectedProject?.id])
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => localStorage.getItem('tbc_notifications') === 'true')
  const [reportsPanelOpen, setReportsPanelOpen] = useState(false)
  const [focusedReportId, setFocusedReportId] = useState(null)
  
  // Scroll to focused report when panel opens
  useEffect(() => {
    if (reportsPanelOpen && focusedReportId) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-report-id="${focusedReportId}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // Clear highlight after animation
        const clearTimer = setTimeout(() => setFocusedReportId(null), 2000)
        return () => clearTimeout(clearTimer)
      }, 350) // wait for panel open animation
      return () => clearTimeout(timer)
    }
  }, [reportsPanelOpen, focusedReportId])

  const liveLogAtBottomRef = useRef(true)

  // Keep liveLogAtBottomRef in sync as the user scrolls
  const onLiveLogScroll = useCallback((e) => {
    const el = e.currentTarget
    liveLogAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  const liveLogRef = useRef(null)

  const [notifCenter, setNotifCenter] = useState(false)
  const [notifList, setNotifList] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hasGlobalToken, setHasGlobalToken] = useState(false)
  const [globalTokenPreview, setGlobalTokenPreview] = useState(null)
  const [globalTokenType, setGlobalTokenType] = useState(null)
  const [globalTokenInput, setGlobalTokenInput] = useState('')
  const [providerTokens, setProviderTokens] = useState({})
  const [tokenSaving, setTokenSaving] = useState(false)
  const [expandedNotifs, setExpandedNotifs] = useState(new Set())
  const [detailedNotifs, setDetailedNotifs] = useState(() => localStorage.getItem('tbc_detailed_notifs') === 'true')
  const detailedNotifsRef = useRef(detailedNotifs)
  useEffect(() => { detailedNotifsRef.current = detailedNotifs }, [detailedNotifs])

  // Register service worker (production only — dev causes reload loops)
  useEffect(() => {
    if ('serviceWorker' in navigator && !import.meta.env.DEV) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  // Fetch settings + notifications on mount
  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(d => { setHasGlobalToken(!!d.hasGlobalToken); setGlobalTokenPreview(d.globalTokenPreview || null); setGlobalTokenType(d.tokenType || null); setProviderTokens(d.providers || {}) }).catch(() => {})
    fetch('/api/notifications').then(r => r.json()).then(d => setNotifList(Array.isArray(d) ? d : [])).catch(() => {})
    if (new URLSearchParams(window.location.search).has('notif')) {
      setNotifCenter(true)
      navigate('/', { replace: true })
    }
    // Listen for SW messages to open notification center
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.action === 'openNotifCenter') setNotifCenter(true)
      })
    }
  }, [])

  // SSE connection for real-time notifications
  useEffect(() => {
    if (!notificationsEnabled) return
    const evtSource = new EventSource('/api/events')
    evtSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)
        if (event.type === 'connected') return
        const messages = {
          milestone: `📌 New milestone: ${event.title}`,
          verified: `✅ Milestone verified: ${event.title}`,
          'verify-fail': `❌ Verification failed: ${event.title}`,
          phase: `🔄 ${event.project}: → ${event.phase}`,
          error: `⚠️ ${event.project}: ${event.message}`,
        }
        const body = messages[event.type] || JSON.stringify(event)
        const tag = `tbc-${event.type}-${event.project}`
        // Add to in-app notification list
        if (event.notification) {
          setNotifList(prev => [event.notification, ...prev].slice(0, 200))
        }
        // Push notifications are handled server-side via Web Push (VAPID)
        // No need to trigger from frontend SSE
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

  const toggleNotifications = async () => {
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
  }

  // Auto-subscribe on load if notifications were previously enabled
  useEffect(() => {
    if (notificationsEnabled && 'serviceWorker' in navigator) {
      subscribeToPush()
    }
  }, [])
  const markAllRead = () => {
    fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {})
    setNotifList(prev => prev.map(n => ({ ...n, read: true })))
  }

  const markRead = (id) => {
    fetch(`/api/notifications/${id}/read`, { method: 'POST' }).catch(() => {})
    setNotifList(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  const unreadCount = notifList.filter(n => !n.read).length

  const [intervalInfoModal, setIntervalInfoModal] = useState(false)
  const [timeoutInfoModal, setTimeoutInfoModal] = useState(false)
  const [logsAutoFollow, setLogsAutoFollow] = useState(true)
  const [projectLoading, setProjectLoading] = useState(false)
  const [toast, setToast] = useState(null)
  const logsRef = useRef(null)
  const reportsScrollRef = useRef(null)

  const prevAgentRef = useRef(null)


  // Dark mode
  // Theme: 'light' | 'dark' | 'system'
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system')
  const darkMode = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

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

  const cycleTheme = () => setTheme(t => t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light')

  const projectApi = (path) => selectedProject ? `/api/projects/${selectedProject.id}${path}` : null

  const authHeaders = () => {
    if (!authPassword) return {}
    return { 'Authorization': 'Basic ' + btoa(':' + authPassword) }
  }

  const authFetch = (url, opts = {}) => {
    const headers = { ...opts.headers, ...authHeaders() }
    return fetch(url, { ...opts, headers })
  }

  const checkAuth = async (password) => {
    try {
      const headers = password ? { 'Authorization': 'Basic ' + btoa(':' + password) } : {}
      const res = await fetch('/api/auth', { headers })
      const data = await res.json()
      setIsWriteMode(data.authenticated)
      return data.authenticated
    } catch { return false }
  }

  useEffect(() => { checkAuth(authPassword) }, [])

  const handleLogin = async () => {
    const ok = await checkAuth(loginInput)
    if (ok) {
      setAuthPassword(loginInput)
      localStorage.setItem('tbc_password', loginInput)
      setLoginModal(false)
      setLoginInput('')
    } else {
      setLoginInput('')
    }
  }

  const handleLogout = () => {
    setAuthPassword('')
    setIsWriteMode(false)
    localStorage.removeItem('tbc_password')
  }

  const showToast = (message, type = 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchGlobalStatus = async () => {
    try {
      const res = await fetch('/api/status')
      const data = await res.json()
      setGlobalUptime(data.uptime)
      setProjects(data.projects)
      
      // Only update selectedProject if we're still on a project page
      // Check pathname to avoid overriding navigation back to list
      if (location.pathname !== '/') {
        setSelectedProject(prev => {
          if (!prev) return prev
          const updated = data.projects.find(p => p.id === prev.id)
          if (updated) {
            const prevAgent = prevAgentRef.current
            const curAgent = updated.currentAgent || null
            // Agent changed (finished or new one started) → refresh project data
            if (prevAgent !== null && prevAgent !== curAgent) {
              fetchProjectData()
              fetchComments(1, localStorage.getItem('selectedAgent') || null, false)
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

  const selectedProjectRef = useRef(null)
  useEffect(() => { selectedProjectRef.current = selectedProject }, [selectedProject])

  const fetchProjectData = async (initial = false) => {
    const currentProject = selectedProjectRef.current
    const baseApi = currentProject ? `/api/projects/${currentProject.id}` : null
    if (!baseApi) return
    if (initial) setProjectLoading(true)
    
    try {
      const [logsRes, agentsRes, configRes, prsRes, issuesRes, repoRes] = await Promise.all([
        fetch(`${baseApi}/logs?lines=100`),
        fetch(`${baseApi}/agents`),
        fetch(`${baseApi}/config`),
        fetch(`${baseApi}/prs`),
        fetch(`${baseApi}/issues`).catch(() => ({ ok: false })),
        fetch(`${baseApi}/repo`)
      ])
      
      // Verify we're still on the same project before setting state
      if (selectedProjectRef.current?.id !== currentProject.id) return
      
      setLogs((await logsRes.json()).logs || [])
      setAgents(await agentsRes.json())
      
      const configData = await configRes.json()
      setConfig(configData)
      setHasProjectToken(!!configData.hasProjectToken)
      setProjectTokenPreview(configData.projectTokenPreview || null)
      setProjectTokenProviderLabel(configData.provider || null)
      if (!configDirtyRef.current && configData.config) {
        setConfigForm({
          cycleIntervalMs: configData.config.cycleIntervalMs ?? 1800000,
          agentTimeoutMs: configData.config.agentTimeoutMs ?? 900000,
          trackerIssue: configData.config.trackerIssue ?? 1,
          budgetPer24h: configData.config.budgetPer24h ?? 0
        })
      }
      
      setPrs((await prsRes.json()).prs || [])
      if (issuesRes.ok) {
        setIssues((await issuesRes.json()).issues || [])
      }
      setRepoUrl((await repoRes.json()).url)
    } catch (err) {
      console.error('Failed to fetch project data:', err)
      if (initial) showToast('Failed to load project data')
    } finally {
      setProjectLoading(false)
    }
  }
  
  const controlAction = async (action) => {
    if (!selectedProject) return
    try {
      const res = await authFetch(projectApi(`/${action}`), { method: 'POST' })
      if (res.ok) await fetchGlobalStatus()
      else showToast(`Action "${action}" failed`)
    } catch (err) { showToast(`Action "${action}" failed: ${err.message}`) }
  }
  
  const saveConfig = async () => {
    if (!selectedProject) return
    setConfigSaving(true)
    setConfigError(null)
    try {
      // Merge form values into existing config to preserve keys like managers:
      const existing = config.config || {}
      const merged = { ...existing,
        cycleIntervalMs: configForm.cycleIntervalMs,
        agentTimeoutMs: configForm.agentTimeoutMs,
        trackerIssue: configForm.trackerIssue,
      }
      if (configForm.budgetPer24h > 0) merged.budgetPer24h = configForm.budgetPer24h
      else delete merged.budgetPer24h
      // Build YAML: comment + sorted keys (simple scalars first, then objects)
      const lines = [`# ${selectedProject.id} - Orchestrator Configuration`]
      const scalarKeys = Object.keys(merged).filter(k => typeof merged[k] !== 'object' || merged[k] === null)
      const objectKeys = Object.keys(merged).filter(k => typeof merged[k] === 'object' && merged[k] !== null)
      for (const k of scalarKeys) lines.push(`${k}: ${merged[k]}`)
      for (const k of objectKeys) {
        lines.push(`${k}:`)
        for (const [sk, sv] of Object.entries(merged[k])) {
          if (typeof sv === 'object' && sv !== null) {
            lines.push(`  ${sk}:`)
            for (const [ssk, ssv] of Object.entries(sv)) lines.push(`    ${ssk}: ${ssv}`)
          } else {
            lines.push(`  ${sk}: ${sv}`)
          }
        }
      }
      const yaml = lines.join('\n') + '\n'
      const res = await authFetch(projectApi('/config'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: yaml })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      configDirtyRef.current = false
      setConfigDirty(false)
      await fetchProjectData()
    } catch (err) { setConfigError(err.message) }
    finally { setConfigSaving(false) }
  }
  
  const updateConfigField = (field, value) => {
    configDirtyRef.current = true
    setConfigForm(prev => ({ ...prev, [field]: value }))
    setConfigDirty(true)
    setConfigError(null)
  }

  const resetConfig = () => {
    if (config.config) {
      setConfigForm({
        cycleIntervalMs: config.config.cycleIntervalMs ?? 1800000,
        agentTimeoutMs: config.config.agentTimeoutMs ?? 900000,
        trackerIssue: config.config.trackerIssue ?? 1,
        budgetPer24h: config.config.budgetPer24h ?? 0
      })
    }
    configDirtyRef.current = false
    setConfigDirty(false)
    setConfigError(null)
  }
  
  const fetchComments = async (page = 1, agent = null, append = false, silent = false) => {
    const currentProject = selectedProjectRef.current
    const baseApi = currentProject ? `/api/projects/${currentProject.id}` : null
    if (!baseApi) return
    if (!silent) setCommentsLoading(true)
    try {
      const params = new URLSearchParams({ page, per_page: 10 })
      if (agent) params.set('agent', agent)
      const res = await fetch(`${baseApi}/reports?${params}`)
      if (!res.ok) return
      if (selectedProjectRef.current?.id !== currentProject.id) return
      const data = await res.json()
      if (append) setComments(prev => [...prev, ...data.reports])
      else setComments(data.reports || [])
      setCommentsHasMore((data.page * data.perPage) < data.total)
      setCommentsPage(page)
    } catch (err) { console.error('Failed to fetch comments:', err) }
    finally { if (!silent) setCommentsLoading(false) }
  }
  
  const loadMoreComments = () => {
    if (!commentsLoading && commentsHasMore) fetchComments(commentsPage + 1, selectedAgent, true)
  }
  
  const selectAgent = (agent) => {
    setSelectedAgent(agent)
    localStorage.setItem('selectedAgent', agent)
    setCommentsPage(1)
    fetchComments(1, agent, false)
  }
  
  const clearAgentFilter = () => {
    setSelectedAgent(null)
    localStorage.removeItem('selectedAgent')
    setCommentsPage(1)
    fetchComments(1, null, false)
  }
  
  const openAgentModal = async (agentName) => {
    if (!selectedProject) return
    setAgentModal({ open: true, agent: agentName, data: null, loading: true, tab: 'skill' })
    try {
      const res = await fetch(projectApi(`/agents/${agentName}`))
      const data = await res.json()
      setAgentModal({ open: true, agent: agentName, data, loading: false, tab: 'skill' })
    } catch (err) {
      setAgentModal({ open: true, agent: agentName, data: null, loading: false, tab: 'skill' })
    }
  }

  const openBootstrapModal = async () => {
    if (!selectedProject) return
    setBootstrapModal({ open: true, loading: true, preview: null, error: null, executing: false, removeRoadmap: true, specMode: 'keep', specContent: '', whatToBuild: '', successCriteria: '' })
    try {
      const res = await authFetch(projectApi('/bootstrap'))
      const data = await res.json()
      setBootstrapModal({ open: true, loading: false, preview: data, error: null, executing: false, removeRoadmap: !!data.hasRoadmap, specMode: 'keep', specContent: data.specContent || '', whatToBuild: '', successCriteria: '' })
    } catch (err) {
      setBootstrapModal({ open: true, loading: false, preview: null, error: err.message, executing: false, removeRoadmap: true, specMode: 'keep', specContent: '', whatToBuild: '', successCriteria: '' })
    }
  }

  const executeBootstrap = async () => {
    if (!selectedProject) return
    setBootstrapModal(prev => ({ ...prev, executing: true, error: null }))
    try {
      const body = {
        removeRoadmap: bootstrapModal.removeRoadmap,
        spec: {
          mode: bootstrapModal.specMode,
          content: bootstrapModal.specContent,
          whatToBuild: bootstrapModal.whatToBuild,
          successCriteria: bootstrapModal.successCriteria,
        }
      }
      const res = await authFetch(projectApi('/bootstrap'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setBootstrapModal({ open: false, loading: false, preview: null, error: null, executing: false, removeRoadmap: true, specMode: 'keep', specContent: '', whatToBuild: '', successCriteria: '' })
      await fetchGlobalStatus()
      await fetchProjectData()
      fetchComments(1, selectedAgent, false)
    } catch (err) {
      setBootstrapModal(prev => ({ ...prev, executing: false, error: err.message }))
    }
  }

  const createIssue = async () => {
    if (!createIssueModal.title.trim()) return
    setCreateIssueModal(prev => ({ ...prev, creating: true, error: null }))
    try {
      const res = await authFetch(projectApi('/issues/create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: createIssueModal.title.trim(),
          body: createIssueModal.body.trim(),
          creator: 'human',
          assignee: createIssueModal.receiver || null
        })
      })
      const data = await res.json()
      if (data.success) {
        setCreateIssueModal({ open: false, title: '', body: '', receiver: '', creating: false, error: null, focusedField: 'title' })
        await fetchProjectData()
      } else {
        setCreateIssueModal(prev => ({ ...prev, creating: false, error: data.error || 'Failed to create issue' }))
      }
    } catch (err) {
      setCreateIssueModal(prev => ({ ...prev, creating: false, error: err.message }))
    }
  }

  const openIssueModal = async (issueId) => {
    if (!selectedProject) return
    setIssueModal({ open: true, issue: null, comments: [], loading: true })
    try {
      const res = await fetch(projectApi(`/issues/${issueId}`))
      const data = await res.json()
      setIssueModal({ open: true, issue: data.issue, comments: data.comments || [], loading: false })
    } catch (err) {
      setIssueModal({ open: true, issue: null, comments: [], loading: false })
    }
  }

  const submitIssueComment = async () => {
    if (!issueModal.issue || !issueModal.newComment?.trim()) return
    setIssueModal(prev => ({ ...prev, commenting: true }))
    try {
      const res = await authFetch(projectApi(`/issues/${issueModal.issue.id}/comments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: 'human', body: issueModal.newComment.trim() })
      })
      if (res.ok) {
        // Refresh issue modal
        const data = await (await fetch(projectApi(`/issues/${issueModal.issue.id}`))).json()
        setIssueModal(prev => ({ ...prev, issue: data.issue, comments: data.comments || [], newComment: '', commenting: false }))
      } else {
        setIssueModal(prev => ({ ...prev, commenting: false }))
      }
    } catch {
      setIssueModal(prev => ({ ...prev, commenting: false }))
    }
  }

  const projectToPath = (project) => {
    if (project.repo) return `/github.com/${project.repo}`
    return `/${project.id}`
  }

  const closeAllModals = () => {
    setAgentModal({ open: false, agent: null, data: null, loading: false, tab: 'skill' })
    setIssueModal({ open: false, issue: null, comments: [], loading: false })
    setCreateIssueModal({ open: false, title: '', body: '', creating: false, error: null })
    setBootstrapModal({ open: false, loading: false, preview: null, error: null, executing: false })
    setAgentSettingsModal({ open: false, agent: null, model: '', saving: false, error: null })
    setProjectSettingsOpen(false)
    setBudgetInfoModal(false)
    setIntervalInfoModal(false)
    setTimeoutInfoModal(false)
    setSettingsOpen(false)
    setLoginModal(false)
    setNotifCenter(false)
    resetAddProjectModal()
  }

  const selectProject = (project) => {
    closeAllModals()
    setSelectedProject(project)
    navigate(projectToPath(project))
    setLogs([])
    setAgents({ workers: [], managers: [] })
    setComments([])
    setCommentsPage(1)
    setPrs([])
    setIssues([])
    setIssueFilter('open')
  }

  const goToProjectList = () => {
    closeAllModals()
    setSelectedProject(null)
    navigate('/')
  }

  const resetAddProjectModal = () => {
    setAddProjectModal({
      step: null, githubUrl: '', projectId: null, projectPath: null,
      hasSpec: false, specContent: null, whatToBuild: '', successCriteria: '',
      updateSpec: false, error: null, repoMode: 'existing',
      orgs: [], repos: [], selectedOrg: '', selectedRepo: '', orgsLoading: false, reposLoading: false,
      inputMode: 'dropdown', newRepoName: '', newRepoPrivate: false, newRepoDescription: '', creatingRepo: false,
      budgetPer24h: 40,
    })
  }

  const openAddProjectModal = () => {
    setAddProjectModal(prev => ({ ...prev, step: 'url', error: null, budgetPer24h: 40, orgs: [], repos: [], selectedOrg: '', selectedRepo: '', orgsLoading: true, inputMode: 'dropdown' }))
    // Fetch orgs
    fetch('/api/github/orgs')
      .then(r => r.json())
      .then(data => {
        setAddProjectModal(prev => ({ ...prev, orgs: data.orgs || [], orgsLoading: false, selectedOrg: data.user || '' }))
        // Auto-load repos for the user
        if (data.user) {
          fetchReposForOrg(data.user)
        }
      })
      .catch(() => {
        setAddProjectModal(prev => ({ ...prev, orgsLoading: false, inputMode: 'url' }))
      })
  }

  const fetchReposForOrg = (org) => {
    setAddProjectModal(prev => ({ ...prev, reposLoading: true, repos: [], selectedRepo: '' }))
    fetch(`/api/github/repos?owner=${encodeURIComponent(org)}`)
      .then(r => r.json())
      .then(data => {
        setAddProjectModal(prev => ({ ...prev, repos: data.repos || [], reposLoading: false }))
      })
      .catch(() => {
        setAddProjectModal(prev => ({ ...prev, reposLoading: false }))
      })
  }

  const createNewRepo = async () => {
    const { selectedOrg, newRepoName, newRepoPrivate, newRepoDescription } = addProjectModal
    if (!newRepoName.trim()) return
    setAddProjectModal(prev => ({ ...prev, creatingRepo: true, error: null }))
    try {
      const res = await authFetch('/api/github/create-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRepoName.trim(), owner: selectedOrg, isPrivate: newRepoPrivate, description: newRepoDescription.trim() })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAddProjectModal(prev => ({
        ...prev, step: 'spec', projectId: data.id, projectPath: data.path,
        hasSpec: false, specContent: null, creatingRepo: false, error: null,
      }))
    } catch (err) {
      setAddProjectModal(prev => ({ ...prev, creatingRepo: false, error: err.message }))
    }
  }

  const cloneSelectedRepo = () => {
    const repo = addProjectModal.repos.find(r => r.name === addProjectModal.selectedRepo)
    if (!repo) return
    const url = `https://github.com/${repo.nameWithOwner}`
    setAddProjectModal(prev => ({ ...prev, githubUrl: url }))
    // Trigger clone with this URL
    setAddProjectModal(prev => ({ ...prev, step: 'cloning', error: null, githubUrl: url }))
    authFetch('/api/projects/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setAddProjectModal(prev => ({
          ...prev, step: 'spec', projectId: data.id, projectPath: data.path,
          hasSpec: data.hasSpec, specContent: data.specContent, error: null,
        }))
      })
      .catch(err => {
        setAddProjectModal(prev => ({ ...prev, step: 'url', error: err.message }))
      })
  }

  const cloneProject = async () => {
    const url = addProjectModal.githubUrl.trim()
    if (!url) return
    setAddProjectModal(prev => ({ ...prev, step: 'cloning', error: null }))
    try {
      const res = await authFetch('/api/projects/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAddProjectModal(prev => ({
        ...prev, step: 'spec', projectId: data.id, projectPath: data.path,
        hasSpec: data.hasSpec, specContent: data.specContent, error: null,
      }))
    } catch (err) {
      setAddProjectModal(prev => ({ ...prev, step: 'url', error: err.message }))
    }
  }

  const finalizeAddProject = async () => {
    const { projectId, projectPath, hasSpec, updateSpec, whatToBuild, successCriteria, budgetPer24h } = addProjectModal
    if (!projectId || !projectPath) return
    setAddProjectModal(prev => ({ ...prev, step: 'adding', error: null }))
    try {
      const body = { id: projectId, path: projectPath, budgetPer24h: parseFloat(budgetPer24h) || 0 }
      if (!hasSpec || updateSpec) {
        body.spec = { whatToBuild: whatToBuild.trim(), successCriteria: successCriteria.trim() }
      }
      const res = await authFetch('/api/projects/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      // Bootstrap workspace
      try {
        await authFetch(`/api/projects/${projectId}/bootstrap`, { method: 'POST' })
      } catch {} // Best effort
      resetAddProjectModal()
      await fetchGlobalStatus()
    } catch (err) {
      setAddProjectModal(prev => ({ ...prev, step: 'confirm', error: err.message }))
    }
  }

  const removeProject = async (projectId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}`, { method: 'DELETE' })
      if (res.ok) {
        if (selectedProject?.id === projectId) {
          setSelectedProject(null)
        }
        await fetchGlobalStatus()
      }
    } catch (err) {
      console.error('Failed to remove project:', err)
    }
  }

  // Restore project from URL path on initial load
  const selectProjectFromPath = (projectList) => {
    const path = location.pathname
    if (path === '/' || !path) return
    // Match /github.com/owner/repo
    const match = path.match(/^\/github\.com\/([^/]+\/[^/]+)/)
    if (match) {
      const repo = match[1]
      const project = projectList.find(p => p.repo === repo || p.id === repo)
      if (project) {
        setSelectedProject(project)
        return
      }
    }
    // Match /projectId
    const id = path.slice(1)
    const project = projectList.find(p => p.id === id)
    if (project) setSelectedProject(project)
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
    const interval = setInterval(fetchGlobalStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  // Handle browser back/forward via react-router location changes
  useEffect(() => {
    if (location.pathname === '/') {
      closeAllModals()
      setSelectedProject(null)
    } else if (!selectedProject) {
      selectProjectFromPath(projects)
    }
  }, [location.pathname])

  const fetchLogs = async () => {
    const api = projectApi('/logs?lines=100')
    if (!api) return
    try {
      const res = await fetch(api)
      if (!res.ok) return
      setLogs((await res.json()).logs || [])
    } catch (err) {
      console.error('Failed to fetch logs:', err)
    }
  }

  useEffect(() => {
    if (selectedProject) {
      fetchProjectData(true)
      const savedAgent = localStorage.getItem('selectedAgent')
      fetchComments(1, savedAgent, false)
      
      // Separate intervals for different data
      const logsInterval = setInterval(fetchLogs, 10000) // Logs every 10s
      const commentsInterval = setInterval(() => fetchComments(1, localStorage.getItem('selectedAgent') || null, false, true), 30000) // Comments every 30s (silent refresh)
      const projectDataInterval = setInterval(fetchProjectData, 30000) // Issues/PRs/agents every 30s
      
      return () => {
        clearInterval(logsInterval)
        clearInterval(commentsInterval)
        clearInterval(projectDataInterval)
      }
    }
  }, [selectedProject?.id])

  // Poll for live agent log when an agent is running
  useEffect(() => {
    if (!selectedProject?.currentAgent) {
      setLiveAgentLog(null)
      return
    }
    const fetchAgentLog = async () => {
      try {
        const res = await fetch(`/api/projects/${selectedProject.id}/agent-log`)
        if (!res.ok) return
        const data = await res.json()
        if (data.running) {
          setLiveAgentLog({ agent: data.agent, model: data.model, startTime: data.startTime, log: data.log })
        } else {
          setLiveAgentLog(null)
        }
      } catch {}
    }
    fetchAgentLog()
    const interval = setInterval(fetchAgentLog, 3000)
    return () => clearInterval(interval)
  }, [selectedProject?.id, selectedProject?.currentAgent])

  useEffect(() => {
    if (logsAutoFollow && logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [logs, logsAutoFollow])

  const formatTime = (date) => date ? date.toLocaleTimeString() : '--:--:--'

  const formatRuntime = (seconds) => {
    if (!seconds) return ''
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}m ${s}s`
  }

  // Available models (fetched from Anthropic API)
  const [availableModels, setAvailableModels] = useState([])
  useEffect(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then(data => {
        if (data.data) setAvailableModels(data.data)
      })
      .catch(() => {})
  }, [])

  // Agent settings modal state
  const [agentSettingsModal, setAgentSettingsModal] = useState({ open: false, agent: null, model: '', saving: false, error: null })

  const openAgentSettings = (agent) => {
    setAgentSettingsModal({ open: false, agent: null, model: '', saving: false, error: null })
    fetch(projectApi(`/agents/${agent.name}`))
      .then(r => r.json())
      .then(data => {
        setAgentSettingsModal({ open: true, agent, model: data.model || '', saving: false, error: null })
      })
      .catch(() => {
        setAgentSettingsModal({ open: true, agent, model: '', saving: false, error: null })
      })
  }

  const saveAgentSettings = async () => {
    setAgentSettingsModal(prev => ({ ...prev, saving: true, error: null }))
    try {
      const res = await fetch(projectApi(`/agents/${agentSettingsModal.agent.name}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: agentSettingsModal.model })
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save')
      setAgentSettingsModal(prev => ({ ...prev, open: false }))
      fetchProjectData()
    } catch (e) {
      setAgentSettingsModal(prev => ({ ...prev, saving: false, error: e.message }))
    }
  }

  // Loading state: URL has a project path but we haven't resolved it yet
  const hasProjectInUrl = location.pathname !== '/' && location.pathname.length > 1
  if (!selectedProject && hasProjectInUrl && projects.length === 0) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-neutral-400" />
      </div>
    )
  }

  // Notification helper
  const toggleNotifExpand = (id) => {
    setExpandedNotifs(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const notifSupported = typeof window !== 'undefined' && 'Notification' in window
  const notifPermission = notifSupported ? Notification.permission : 'default'

  // Project settings: per-project overrides stored in localStorage
  const getProjSetting = (section) => {
    if (!selectedProject) return { useGlobal: true }
    const all = projectNotifs[selectedProject.id] || {}
    return all[section] || { useGlobal: true }
  }
  const setProjSetting = (section, patch) => {
    if (!selectedProject) return
    const all = { ...projectNotifs }
    const proj = { ...(all[selectedProject.id] || {}) }
    proj[section] = { ...(proj[section] || { useGlobal: true }), ...patch }
    all[selectedProject.id] = proj
    setProjectNotifs(all)
    localStorage.setItem('tbc_project_notifs', JSON.stringify(all))
  }

  const projNotifSettings = getProjSetting('notifs')
  const projTokenSettings = getProjSetting('token')
  const notifUseGlobal = projNotifSettings.useGlobal !== false


  // Build shared props for ProjectListPage
  const listPageProps = {
    projects, selectProject, showArchived, setShowArchived,
    unreadCount, notifCenter, setNotifCenter,
    isWriteMode, handleLogout, setLoginModal,
    settingsOpen, setSettingsOpen, openAddProjectModal,
    addProjectModal, setAddProjectModal, resetAddProjectModal,
    cloneProject, cloneSelectedRepo, createNewRepo, fetchReposForOrg, finalizeAddProject,
    loginModal, loginInput, setLoginInput, handleLogin,
    theme, setTheme, notificationsEnabled, toggleNotifications,
    detailedNotifs, setDetailedNotifs, setShowApiKeyHelp,
    globalTokenInput, setGlobalTokenInput, tokenSaving, setTokenSaving,
    setHasGlobalToken, setGlobalTokenType, setProviderTokens, setGlobalTokenPreview,
    setToast, providerTokens, codexLoginState, setCodexLoginState, authFetch,
    notifList, markAllRead, markRead, expandedNotifs, toggleNotifExpand, showApiKeyHelp,
  }

  // Build shared props for ProjectView
  const viewPageProps = {
    ...listPageProps,
    selectedProject, goToProjectList,
    error, projectLoading, globalUptime, controlAction, openBootstrapModal,
    repoUrl, projectApi,
    projectSettingsOpen, setProjectSettingsOpen,
    configForm, configError, configDirty, configSaving,
    updateConfigField, resetConfig, saveConfig,
    setIntervalInfoModal, setTimeoutInfoModal, setBudgetInfoModal,
    intervalInfoModal, timeoutInfoModal, budgetInfoModal,
    agents, prs, comments, commentsLoading, loadMoreComments, liveAgentLog,
    setFocusedReportId, setReportsPanelOpen,
    issues, issueFilter, setIssueFilter, openIssueModal, setCreateIssueModal,
    logs, logsRef, logsAutoFollow, setLogsAutoFollow,
    agentModal, setAgentModal,
    agentSettingsModal, setAgentSettingsModal, saveAgentSettings, availableModels,
    bootstrapModal, setBootstrapModal, executeBootstrap,
    issueModal, setIssueModal, submitIssueComment,
    reportsPanelOpen, focusedReportId,
    selectedAgent, clearAgentFilter, selectAgent, openAgentModal, openAgentSettings,
    createIssueModal, createIssue, modKey,
    setProjSetting, notifUseGlobal, projNotifSettings,
    hasProjectToken, projectTokenPreview, projectTokenProviderLabel,
    projectTokenSaving, setProjectTokenSaving,
    setHasProjectToken, setProjectTokenPreview, setProjectTokenProviderLabel,
    projectTokenInput, setProjectTokenInput,
    projectTokenProvider, setProjectTokenProvider,
    projectCodexLoginState, setProjectCodexLoginState,
    config, setSelectedProject, fetchProjectData, fetchGlobalStatus, removeProject,
    hasGlobalToken, globalTokenPreview,
    toast,
  }

  return (
    <Routes>
      <Route path="/" element={<ProjectListPage {...listPageProps} />} />
      <Route path="*" element={<ProjectView {...viewPageProps} />} />
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
  return <AppErrorBoundary><App /></AppErrorBoundary>;
}

export default AppWithErrorBoundary
