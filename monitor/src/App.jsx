import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Activity, Users, Sparkles, Settings, ScrollText, RefreshCw, Pause, Play, SkipForward, RotateCcw, Square, Save, MessageSquare, X, GitPullRequest, CircleDot, Clock, User, UserCheck, Folder, Plus, Trash2, ArrowLeft, Github, DollarSign, Sun, Moon, Monitor, Filter, Info, ChevronDown, Lock, Unlock, Bell, BellOff } from 'lucide-react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'
import { PanelProvider, Panel, PanelSlot, PanelHeader, PanelContent, usePanelOpen } from '@/components/ui/panel'
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
      window.history.replaceState({}, '', '/')
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
      if (window.location.pathname !== '/') {
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
    history.pushState(null, '', projectToPath(project))
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
    history.pushState(null, '', '/')
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
    const path = window.location.pathname
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

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      closeAllModals()
      if (window.location.pathname === '/') {
        setSelectedProject(null)
      } else {
        selectProjectFromPath(projects)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [projects])

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
  const hasProjectInUrl = window.location.pathname !== '/' && window.location.pathname.length > 1
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

  const projectSettingsModal = selectedProject && (
    <Panel id="project-settings" open={projectSettingsOpen} onClose={() => setProjectSettingsOpen(false)}>
      <PanelHeader onClose={() => setProjectSettingsOpen(false)}>Project Settings</PanelHeader>
      <PanelContent>
        {/* Notifications section */}
        <div className="pb-5">
          <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-3">Notifications</h3>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-neutral-700 dark:text-neutral-300">Use Global Setting</span>
            <button
              onClick={() => setProjSetting('notifs', { useGlobal: !notifUseGlobal })}
              className={`relative w-11 h-6 rounded-full transition-colors ${notifUseGlobal ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notifUseGlobal ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          <div className={notifUseGlobal ? 'opacity-40 pointer-events-none' : ''}>
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-neutral-700 dark:text-neutral-300">Push Notifications</span>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">Milestones, verifications, and errors</p>
              </div>
              <button
                onClick={() => setProjSetting('notifs', { push: !(projNotifSettings.push !== false) })}
                className={`relative w-11 h-6 rounded-full transition-colors ${projNotifSettings.push !== false ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${projNotifSettings.push !== false ? 'translate-x-5' : ''}`} />
              </button>
            </div>
            <div className="flex items-center justify-between py-2">
              <div>
                <span className="text-sm text-neutral-700 dark:text-neutral-300">Detailed Notifications</span>
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">Push on every agent response</p>
              </div>
              <button
                onClick={() => setProjSetting('notifs', { detailed: !projNotifSettings.detailed })}
                className={`relative w-11 h-6 rounded-full transition-colors ${projNotifSettings.detailed ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${projNotifSettings.detailed ? 'translate-x-5' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Models section */}
        <div className="border-t border-neutral-200 dark:border-neutral-700 pt-5">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Models</h3>
            <button
              onClick={() => setShowApiKeyHelp(true)}
              className="text-neutral-400 hover:text-blue-500 dark:text-neutral-500 dark:hover:text-blue-400 transition-colors"
              title="How to get API keys"
            >
              <Info className="w-4 h-4" />
            </button>
          </div>
          <div className="py-2 space-y-3">
            {/* Current key status */}
            {hasProjectToken ? (
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 shrink-0">
                    {projectTokenProviderLabel ? projectTokenProviderLabel.charAt(0).toUpperCase() + projectTokenProviderLabel.slice(1) : detectProvider(projectTokenPreview) || 'API Key'}
                  </span>
                  <code className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{projectTokenPreview}</code>
                </div>
                <button
                  onClick={async () => {
                    setProjectTokenSaving(true)
                    try {
                      const res = await authFetch(projectApi('/token'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: '' })
                      })
                      if (res.ok) {
                        setHasProjectToken(false)
                        setProjectTokenPreview(null)
                        setProjectTokenProviderLabel(null)
                        setToast('Project token removed')
                      }
                    } catch {}
                    setProjectTokenSaving(false)
                  }}
                  className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            ) : (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                {hasGlobalToken ? `Using global token (${globalTokenPreview})` : 'No token configured'}
              </p>
            )}
            {/* Input for new key */}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <select
                  value={projectTokenProvider}
                  onChange={e => setProjectTokenProvider(e.target.value)}
                  className="w-full sm:w-40 shrink-0 px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
                >
                  <option value="">Provider...</option>
                  <option value="anthropic">Anthropic (API Key)</option>
                  <option value="anthropic-oauth">Anthropic (OAuth)</option>
                  <option value="openai">OpenAI</option>
                  <option value="google">Google (Gemini)</option>
                  <option value="minimax">MiniMax</option>
                </select>
                <input
                  type="password"
                  placeholder={hasProjectToken ? 'Replace with new key...' : 'Paste API key...'}
                  value={projectTokenInput}
                  onChange={e => setProjectTokenInput(e.target.value)}
                  className="flex-1 min-w-0 px-3 py-2 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200"
                />
                <button
                  onClick={async () => {
                    if (!projectTokenProvider || !projectTokenInput) return
                    setProjectTokenSaving(true)
                    try {
                      const providerValue = projectTokenProvider === 'anthropic-oauth' ? 'anthropic' : projectTokenProvider
                      const res = await authFetch(projectApi('/token'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: projectTokenInput, provider: providerValue })
                      })
                      if (res.ok) {
                        const d = await res.json()
                        setHasProjectToken(d.hasProjectToken)
                        setProjectTokenPreview(d.hasProjectToken ? projectTokenInput.slice(0, 4) + '****' + projectTokenInput.slice(-4) : null)
                        setProjectTokenProviderLabel(providerValue)
                        setProjectTokenInput('')
                        setProjectTokenProvider('')
                        setToast(`${providerValue.charAt(0).toUpperCase() + providerValue.slice(1)} key saved`)
                      }
                    } catch {}
                    setProjectTokenSaving(false)
                  }}
                  disabled={projectTokenSaving || !projectTokenProvider || !projectTokenInput}
                  className="px-3 py-2 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 shrink-0"
                >
                  {projectTokenSaving ? '...' : 'Save'}
                </button>
              </div>
            </div>
            {/* OpenAI Codex (ChatGPT OAuth) — per-project */}
            <div className="flex items-center justify-between text-xs py-1 mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-700/50">
              <span className={projectCodexLoginState === 'success' ? 'text-green-600 dark:text-green-400' : 'text-neutral-400 dark:text-neutral-500'}>
                {projectCodexLoginState === 'success' ? '✓' : '○'} OpenAI Codex (ChatGPT)
              </span>
              {projectCodexLoginState === 'success' ? (
                <button
                  onClick={async () => {
                    await authFetch(`/api/openai-codex/logout?project=${encodeURIComponent(selectedProject.id)}`, { method: 'POST' })
                    setProjectCodexLoginState(null)
                    setToast('Project ChatGPT account disconnected')
                  }}
                  className="text-red-500 hover:text-red-700 text-xs"
                >
                  Disconnect
                </button>
              ) : projectCodexLoginState === 'waiting' ? (
                <span className="text-xs text-blue-500 animate-pulse">Waiting for sign-in...</span>
              ) : (
                <button
                  onClick={async () => {
                    if (!selectedProject?.id) return
                    try {
                      setProjectCodexLoginState('polling')
                      const res = await authFetch(`/api/openai-codex/login?project=${encodeURIComponent(selectedProject.id)}`, { method: 'POST' })
                      if (!res.ok) throw new Error('Failed')
                      const data = await res.json()
                      setProjectCodexLoginState('waiting')
                      window.open(data.authorization_url, '_blank')
                      const pollInterval = setInterval(async () => {
                        try {
                          const statusRes = await fetch(`/api/openai-codex/status?project=${encodeURIComponent(selectedProject.id)}`)
                          const status = await statusRes.json()
                          if (status.authenticated) {
                            clearInterval(pollInterval)
                            setProjectCodexLoginState('success')
                            setToast('Project ChatGPT account connected')
                          }
                        } catch {}
                      }, 3000)
                      setTimeout(() => {
                        clearInterval(pollInterval)
                        setProjectCodexLoginState(prev => prev === 'success' ? prev : null)
                      }, 300000)
                    } catch {
                      setProjectCodexLoginState(null)
                    }
                  }}
                  disabled={projectCodexLoginState === 'polling'}
                  className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-xs"
                >
                  {projectCodexLoginState === 'polling' ? 'Starting...' : 'Login'}
                </button>
              )}
            </div>
            {projectCodexLoginState === 'waiting' && (
              <div className="mt-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs">
                <p className="text-blue-700 dark:text-blue-300">Complete sign-in in the browser tab that just opened.</p>
              </div>
            )}
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-2">
              {codexLoginState === 'success' && projectCodexLoginState !== 'success' ? 'Using global ChatGPT login' : ''}
            </p>
          </div>
        </div>

        {/* Model Tiers */}
        {isWriteMode && (() => {
          const currentModels = selectedProject?.config?.models || {};
          const hasOverrides = !!(currentModels.high || currentModels.mid || currentModels.low);
          const provider = config?.provider || 'anthropic';
          const providerTiers = config?.tiers || {};
          const providerModels = [...new Set(Object.values(providerTiers).map(t => t.model).filter(Boolean))];
          const allTiers = config?.allTiers || {};
          const allModels = [...new Set(Object.values(allTiers).flatMap(p => Object.values(p).map(t => t.model)).filter(Boolean))];

          const saveModels = async (models) => {
            try {
              await authFetch(projectApi('/models'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ models })
              });
              await fetchProjectData();
            } catch {}
          };

          return (
          <div className="border-t border-neutral-200 dark:border-neutral-700 pt-5 mt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Manual Model Selection</h3>
              <button
                type="button"
                role="switch"
                aria-checked={hasOverrides}
                onClick={() => {
                  if (hasOverrides) {
                    setSelectedProject(prev => prev ? { ...prev, config: { ...prev.config, models: {} } } : prev);
                    saveModels({}).then(() => setToast('Model overrides disabled'));
                  } else {
                    const defaults = {};
                    for (const tier of ['high', 'mid', 'low']) {
                      if (providerTiers[tier]) defaults[tier] = providerTiers[tier].model;
                    }
                    setSelectedProject(prev => prev ? { ...prev, config: { ...prev.config, models: defaults } } : prev);
                    saveModels(defaults).then(() => setToast('Model overrides enabled'));
                  }
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${hasOverrides ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${hasOverrides ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            {hasOverrides ? (
              <div className="space-y-2">
                {['high', 'mid', 'low'].map(tier => (
                  <div key={tier} className="flex items-center gap-2">
                    <span className={`text-xs font-bold w-10 shrink-0 ${tier === 'high' ? 'text-purple-500' : tier === 'mid' ? 'text-blue-500' : 'text-neutral-400'}`}>{tier.toUpperCase()}</span>
                    <select
                      value={currentModels[tier] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        const models = { ...currentModels };
                        if (val) models[tier] = val; else delete models[tier];
                        setSelectedProject(prev => prev ? { ...prev, config: { ...prev.config, models } } : prev);
                        saveModels(models);
                      }}
                      className="flex-1 min-w-0 px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                    >
                      <option value="">Default ({providerTiers[tier]?.model || '—'})</option>
                      {providerModels.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      {allModels.filter(m => !providerModels.includes(m)).length > 0 && (
                        <optgroup label="Other providers">
                          {allModels.filter(m => !providerModels.includes(m)).map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-neutral-400 dark:text-neutral-500">Using global defaults ({provider}). Enable to customize per tier.</p>
            )}
          </div>
          );
        })()}

        {/* Danger Zone */}
        {isWriteMode && (
          <div className="border-t border-red-200 dark:border-red-900 pt-5 mt-5">
            <h3 className="text-sm font-semibold text-red-500 dark:text-red-400 uppercase tracking-wider mb-3">Danger Zone</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 border border-neutral-200 dark:border-neutral-700 rounded-lg">
                <div>
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    {selectedProject?.archived ? 'Unarchive Project' : 'Archive Project'}
                  </span>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
                    {selectedProject?.archived ? 'Restore this project to the active dashboard' : 'Hide from dashboard. Data is preserved.'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const action = selectedProject?.archived ? 'unarchive' : 'archive'
                    try {
                      await authFetch(projectApi(`/${action}`), { method: 'POST' })
                      await fetchGlobalStatus()
                      await fetchProjectData()
                      setToast(action === 'archive' ? 'Project archived' : 'Project unarchived')
                    } catch {}
                  }}
                >
                  {selectedProject?.archived ? 'Unarchive' : 'Archive'}
                </Button>
              </div>
              <div className="flex items-center justify-between p-3 border border-red-200 dark:border-red-800 rounded-lg bg-red-50/50 dark:bg-red-950/20">
                <div>
                  <span className="text-sm font-medium text-red-600 dark:text-red-400">Delete Project</span>
                  <p className="text-xs text-red-400 dark:text-red-500 mt-0.5">Permanently remove this project and all data</p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    if (!confirm(`Are you sure you want to permanently delete "${selectedProject?.id}"? This cannot be undone.`)) return
                    if (!confirm('This will delete all workspace data, agent skills, and history. Really delete?')) return
                    try {
                      await removeProject(selectedProject.id)
                      setProjectSettingsOpen(false)
                    } catch {}
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </PanelContent>
    </Panel>
  )

  if (!selectedProject) {
    return (
      <div className="flex min-h-screen">
      <div className="flex-1 min-w-0 bg-neutral-50 dark:bg-neutral-950 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-start sm:items-center justify-between gap-2">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-neutral-800 dark:text-neutral-100">TheBotCompany</h1>
                <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1 hidden sm:block">Multi-project AI Agent Orchestrator</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setNotifCenter(true)}
                  className="px-2 py-1.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 transition-colors relative"
                  title="Notification Center"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => isWriteMode ? handleLogout() : setLoginModal(true)}
                  className={`px-2 py-1.5 rounded transition-colors ${isWriteMode ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-600'}`}
                  title={isWriteMode ? 'Write mode (click to lock)' : 'Read-only (click to unlock)'}
                >
                  {isWriteMode ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="px-2 py-1.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 transition-colors"
                  title="Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Project List */}
          {projects.some(p => p.archived) && (
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setShowArchived(prev => !prev)}
                className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
              >
                {showArchived ? 'Hide archived' : `Show archived (${projects.filter(p => p.archived).length})`}
              </button>
            </div>
          )}
          <div className="space-y-4">
            {projects.filter(p => showArchived || !p.archived).map(project => (
              <Card key={project.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => selectProject(project)}>
                <CardContent className="p-4">
                  {/* Mobile: Stack vertically. Desktop: Row */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Left: Icon + Title */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-blue-400 to-purple-500 rounded-lg flex items-center justify-center shrink-0">
                        <Folder className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base sm:text-lg font-semibold text-neutral-800 dark:text-neutral-100 truncate">{project.id}</h3>
                        {project.repo && (
                          <a href={`https://github.com/${project.repo}`} target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs sm:text-sm text-blue-500 hover:underline truncate inline-block max-w-full">
                            {project.repo}
                          </a>
                        )}
                        {(project.milestoneTitle || project.milestone) && (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">📌 {project.milestoneTitle || project.milestone}</p>
                        )}
                      </div>
                    </div>
                    
                    {/* Right: Status + Actions */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 pl-13 sm:pl-0">
                      <div className="text-left sm:text-right">
                        <Badge variant={project.isComplete ? (project.completionSuccess ? 'success' : 'destructive') : project.paused ? 'warning' : project.sleeping ? 'secondary' : project.currentAgent ? 'success' : project.running ? 'success' : 'destructive'}>
                          {project.isComplete ? (project.completionSuccess ? '✅ Complete' : '🛑 Ended')
                            : project.paused ? (project.currentAgent ? '⏳ Pausing...' : '⏸️ Paused')
                            : project.sleeping ? '💤 Sleeping' 
                            : project.currentAgent ? `▶ ${project.currentAgent}` 
                            : project.running ? 'Running' 
                            : 'Stopped'}
                        </Badge>
                        {project.sleeping && project.sleepUntil && !project.paused && (
                          <p className="text-xs text-blue-500 dark:text-blue-400 mt-0.5 font-mono">
                            <SleepCountdown sleepUntil={project.sleepUntil} />
                          </p>
                        )}
                        {project.currentAgent && project.currentAgentRuntime > 0 && (
                          <p className="text-xs text-green-500 dark:text-green-400 mt-0.5 font-mono">
                            {Math.floor(project.currentAgentRuntime / 60)}m {project.currentAgentRuntime % 60}s
                          </p>
                        )}
                        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Cycle {project.cycleCount}{project.phase ? ` · ${project.phase}` : ''}</p>
                        {project.cost && project.cost.totalCost > 0 && (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">${project.cost.totalCost.toFixed(2)} · ${project.cost.last24hCost.toFixed(2)}/24h</p>
                        )}
                      </div>
                      {project.archived && (
                        <Badge variant="outline" className="text-[10px] text-neutral-400 dark:text-neutral-500 border-neutral-300 dark:border-neutral-600 shrink-0">Archived</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {projects.length === 0 && (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center text-neutral-500 dark:text-neutral-400">
                    <Folder className="w-16 h-16 mx-auto mb-4 opacity-30" />
                    <p className="text-lg font-medium dark:text-neutral-300">No projects configured</p>
                    <p className="text-sm mt-2">Add a project to get started</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {isWriteMode && <Button onClick={openAddProjectModal} className="w-full" variant="outline">
              <Plus className="w-4 h-4 mr-2" /> Add Project
            </Button>}
          </div>

          <Footer />
        </div>

        {/* Add Project Modal */}
        <AddProjectModal
          addProjectModal={addProjectModal}
          setAddProjectModal={setAddProjectModal}
          resetAddProjectModal={resetAddProjectModal}
          cloneProject={cloneProject}
          cloneSelectedRepo={cloneSelectedRepo}
          createNewRepo={createNewRepo}
          fetchReposForOrg={fetchReposForOrg}
          finalizeAddProject={finalizeAddProject}
        />

        {/* Login Modal */}
        <LoginModal
          open={loginModal}
          onClose={() => { setLoginModal(false); setLoginInput('') }}
          loginInput={loginInput}
          setLoginInput={setLoginInput}
          handleLogin={handleLogin}
        />

        {/* Settings (project list) */}
        <SettingsPanel
          settingsOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          setTheme={setTheme}
          notificationsEnabled={notificationsEnabled}
          toggleNotifications={toggleNotifications}
          detailedNotifs={detailedNotifs}
          setDetailedNotifs={setDetailedNotifs}
          setShowApiKeyHelp={setShowApiKeyHelp}
          globalTokenInput={globalTokenInput}
          setGlobalTokenInput={setGlobalTokenInput}
          tokenSaving={tokenSaving}
          setTokenSaving={setTokenSaving}
          setHasGlobalToken={setHasGlobalToken}
          setGlobalTokenType={setGlobalTokenType}
          setProviderTokens={setProviderTokens}
          setGlobalTokenPreview={setGlobalTokenPreview}
          setToast={setToast}
          providerTokens={providerTokens}
          codexLoginState={codexLoginState}
          setCodexLoginState={setCodexLoginState}
          authFetch={authFetch}
        />

        {/* Notification Center (project list) */}
        <NotificationPanel
          open={notifCenter}
          onClose={() => setNotifCenter(false)}
          notifList={notifList}
          unreadCount={unreadCount}
          markAllRead={markAllRead}
          markRead={markRead}
          expandedNotifs={expandedNotifs}
          toggleNotifExpand={toggleNotifExpand}
        />

        {/* API Key Help Modal */}
        <ApiKeyHelpModal open={showApiKeyHelp} onClose={() => setShowApiKeyHelp(false)} />
      </div>
      <PanelSlot />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
    <div className="flex-1 min-w-0 bg-neutral-50 dark:bg-neutral-950 p-6">
      <div>
        {/* Header - Mobile Friendly */}
        <div className="mb-6 space-y-3">
          {/* Desktop: single row. Mobile: two rows */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            {/* Left: Back button + Title */}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={goToProjectList} className="text-neutral-500 dark:text-neutral-400 shrink-0 px-2">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline ml-1">All Projects</span>
              </Button>
              <h1 className="text-lg sm:text-2xl font-bold text-neutral-800 dark:text-neutral-100 truncate">{selectedProject.id}</h1>
            </div>
            
            {/* Right: Actions */}
            <div className="flex items-center gap-1.5 pl-8 sm:pl-0 shrink-0">
              <button
                onClick={() => setNotifCenter(true)}
                className="p-1.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 transition-colors relative"
                title="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => isWriteMode ? handleLogout() : setLoginModal(true)}
                className={`p-1.5 rounded transition-colors ${isWriteMode ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-600'}`}
                title={isWriteMode ? 'Write mode (click to lock)' : 'Read-only (click to unlock)'}
              >
                {isWriteMode ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setProjectSettingsOpen(true)}
                className="p-1.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 transition-colors"
                title="Project Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              <a href={projectApi('/download')} className="p-1.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 inline-flex items-center" title="Download workspace as ZIP">
                <Save className="w-4 h-4" />
              </a>
              {repoUrl && (
                <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 inline-flex items-center" title="Open on GitHub">
                  <Github className="w-4 h-4" />
                </a>
              )}
              {isWriteMode && (selectedProject.paused ? (
                <button onClick={() => controlAction('resume')} className="p-1.5 rounded bg-green-500 hover:bg-green-600 text-white transition-colors" title="Resume project">
                  <Play className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={() => controlAction('pause')} className="p-1.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 transition-colors" title="Pause project">
                  <Pause className="w-4 h-4" />
                </button>
              ))}
              {isWriteMode && <button onClick={openBootstrapModal} className="p-1.5 rounded bg-red-500 hover:bg-red-600 text-white transition-colors" title="Bootstrap project">
                <RotateCcw className="w-4 h-4" />
              </button>}
            </div>
          </div>
          
          {/* Project tabs - hidden on mobile */}
          {projects.length > 1 && (
            <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto pb-1">
              {projects.filter(p => !p.archived || p.id === selectedProject?.id).map(project => (
                <button
                  key={project.id}
                  onClick={() => selectProject(project)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    selectedProject?.id === project.id
                      ? 'bg-blue-500 text-white'
                      : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-600'
                  }`}
                >
                  {project.id}
                </button>
              ))}
            </div>
          )}
          
          {error && <Badge variant="warning">Error: {error}</Badge>}
        </div>

        {selectedProject && projectLoading && (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
            <span className="ml-3 text-neutral-500 dark:text-neutral-400">Loading project...</span>
          </div>
        )}

        {selectedProject && !projectLoading && (
          <>
            {/* Phase Indicator */}
            {selectedProject.phase && (
              <div className="mb-4 p-4 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700">
                {/* Row 1: Phase badge */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">
                    {selectedProject.phase === 'athena' ? '🧠' : selectedProject.phase === 'implementation' ? '🔨' : selectedProject.phase === 'verification' ? '✅' : '❓'}
                  </span>
                  <Badge variant={
                    selectedProject.phase === 'athena' ? 'default' :
                    selectedProject.phase === 'implementation' ? 'success' :
                    selectedProject.phase === 'verification' ? 'warning' : 'secondary'
                  } className="text-sm capitalize">
                    {selectedProject.phase === 'athena' ? 'Planning' : selectedProject.phase === 'implementation' ? (selectedProject.isFixRound ? 'Fixing' : 'Implementation') : selectedProject.phase === 'verification' ? 'Verification' : selectedProject.phase}
                  </Badge>
                  {selectedProject.milestoneCyclesBudget > 0 && selectedProject.phase === 'implementation' && (
                    <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400 ml-auto">
                      {selectedProject.milestoneCyclesUsed}/{selectedProject.milestoneCyclesBudget} cycles
                    </span>
                  )}
                </div>
                {/* Progress bar */}
                {selectedProject.milestoneCyclesBudget > 0 && selectedProject.phase === 'implementation' && (
                  <div className="w-full h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden mb-2">
                    <div
                      className={`h-full rounded-full transition-all ${
                        (selectedProject.milestoneCyclesUsed / selectedProject.milestoneCyclesBudget) > 0.8 ? 'bg-red-500' :
                        (selectedProject.milestoneCyclesUsed / selectedProject.milestoneCyclesBudget) > 0.5 ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(100, (selectedProject.milestoneCyclesUsed / selectedProject.milestoneCyclesBudget) * 100)}%` }}
                    />
                  </div>
                )}
                {/* Row 2: Milestone description */}
                {(selectedProject.milestoneTitle || selectedProject.milestone) && (
                  <details className="group">
                    <summary className="text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-100 flex items-start gap-1.5 [&::-webkit-details-marker]:hidden list-none">
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 mt-0.5 transition-transform group-open:rotate-180 text-neutral-400" />
                      <span className="line-clamp-1">📌 {selectedProject.milestoneTitle || selectedProject.milestone}</span>
                    </summary>
                    <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2 pl-5 whitespace-pre-wrap leading-relaxed">{selectedProject.milestone}</p>
                  </details>
                )}
              </div>
            )}

            {/* Row 1: State, Cost & Budget, Config */}
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
              {/* State */}
              <OrchestratorStateCard
                selectedProject={selectedProject}
                globalUptime={globalUptime}
                controlAction={controlAction}
                isWriteMode={isWriteMode}
              />

              {/* Cost & Budget */}
              <CostBudgetCard
                selectedProject={selectedProject}
                setBudgetInfoModal={setBudgetInfoModal}
              />

              {/* Config */}
              <ConfigCard
                configForm={configForm}
                configError={configError}
                configDirty={configDirty}
                configSaving={configSaving}
                updateConfigField={updateConfigField}
                resetConfig={resetConfig}
                saveConfig={saveConfig}
                isWriteMode={isWriteMode}
                setIntervalInfoModal={setIntervalInfoModal}
                setTimeoutInfoModal={setTimeoutInfoModal}
                setBudgetInfoModal={setBudgetInfoModal}
              />

              {/* Managers */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4" />Managers ({agents.managers.length})</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {agents.managers.map((agent) => (
                      <WorkerCard
                        key={agent.name}
                        agent={agent}
                        isManager
                        selectedProject={selectedProject}
                        selectedAgent={selectedAgent}
                        openAgentModal={openAgentModal}
                        openAgentSettings={openAgentSettings}
                        selectAgent={selectAgent}
                        clearAgentFilter={clearAgentFilter}
                      />
                    ))}
                    {agents.managers.length === 0 && <p className="text-sm text-neutral-400 dark:text-neutral-500">No managers</p>}
                  </div>
                </CardContent>
              </Card>

              {/* Workers */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Users className="w-4 h-4" />Workers ({agents.workers.length})</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {agents.workers.map((agent) => (
                      <WorkerCard
                        key={agent.name}
                        agent={agent}
                        selectedProject={selectedProject}
                        selectedAgent={selectedAgent}
                        openAgentModal={openAgentModal}
                        openAgentSettings={openAgentSettings}
                        selectAgent={selectAgent}
                        clearAgentFilter={clearAgentFilter}
                      />
                    ))}
                    {agents.workers.length === 0 && <p className="text-sm text-neutral-400 dark:text-neutral-500">No workers</p>}
                  </div>
                </CardContent>
              </Card>

              {/* PRs */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><GitPullRequest className="w-4 h-4" />Open PRs ({prs.length})</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {prs.map((pr) => (
                      <a key={pr.number} href={`${repoUrl}/pull/${pr.number}`} target="_blank" rel="noopener noreferrer"
                        className="block p-2 bg-neutral-50 dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded cursor-pointer transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-neutral-400 dark:text-neutral-500">#{pr.number}</span>
                          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate">{pr.shortTitle || pr.title}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                          {pr.agent && <span className="flex items-center gap-1"><User className="w-3 h-3" />{pr.agent}</span>}
                          <span className="truncate">{pr.headRefName}</span>
                        </div>
                      </a>
                    ))}
                    {prs.length === 0 && <p className="text-sm text-neutral-400 dark:text-neutral-500">No open PRs</p>}
                  </div>
                </CardContent>
              </Card>

              {/* Agent Reports */}
              <AgentReportsCard
                comments={comments}
                commentsLoading={commentsLoading}
                loadMoreComments={loadMoreComments}
                liveAgentLog={liveAgentLog}
                selectedProject={selectedProject}
                setFocusedReportId={setFocusedReportId}
                setReportsPanelOpen={setReportsPanelOpen}
              />

              {/* Issues */}
              <IssuesSidebar
                issues={issues}
                issueFilter={issueFilter}
                setIssueFilter={setIssueFilter}
                openIssueModal={openIssueModal}
                setCreateIssueModal={setCreateIssueModal}
                isWriteMode={isWriteMode}
              />
            </div>

            {/* Row 4: Logs */}
            <Card className="mt-4">
              <CardHeader><CardTitle className="flex items-center gap-2"><ScrollText className="w-4 h-4" />Orchestrator Logs</CardTitle></CardHeader>
              <CardContent>
                <div 
                  ref={logsRef}
                  className="bg-neutral-900 rounded-lg p-3 h-80 overflow-y-auto font-mono text-xs"
                  onScroll={(e) => {
                    const { scrollTop, scrollHeight, clientHeight } = e.target
                    const atBottom = scrollHeight - scrollTop - clientHeight < 50
                    if (!atBottom && logsAutoFollow) setLogsAutoFollow(false)
                    if (atBottom && !logsAutoFollow) setLogsAutoFollow(true)
                  }}
                >
                  {logs.length === 0 ? <p className="text-neutral-500">No logs</p> : logs.map((line, idx) => (
                    <div key={idx} className="text-neutral-300 whitespace-pre-wrap break-all">{line}</div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Footer />
          </>
        )}
      </div>

      {/* Agent Details Modal */}
      <Panel id="agent-detail" open={agentModal.open} onClose={() => setAgentModal({ ...agentModal, open: false })}>
        <PanelHeader onClose={() => setAgentModal({ ...agentModal, open: false })}>
          <span className="capitalize">{agentModal.agent}</span>
          {agentModal.data?.isManager && <Badge variant="secondary" className="ml-2">Manager</Badge>}
        </PanelHeader>
        <PanelContent>
          {agentModal.loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
            </div>
          ) : agentModal.data ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-neutral-600 dark:text-neutral-300">Model</h3>
                <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-sm rounded">{agentModal.data.model || 'inherited'}</span>
              </div>
              {/* Tabs: Skill | Workspace */}
              <div className="flex border-b border-neutral-200 dark:border-neutral-700">
                <button
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${agentModal.tab === 'skill' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
                  onClick={() => setAgentModal(prev => ({ ...prev, tab: 'skill' }))}
                >Skill</button>
                <button
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${agentModal.tab === 'workspace' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
                  onClick={() => setAgentModal(prev => ({ ...prev, tab: 'workspace' }))}
                >Workspace</button>
              </div>
              {agentModal.tab === 'skill' ? (
              <div className="space-y-3">
                {/* Agent Skill - shown first and open by default */}
                <details open>
                  <summary className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase cursor-pointer select-none py-1 hover:text-neutral-700 dark:hover:text-neutral-300">Agent Skill — {agentModal.agent}.md</summary>
                  <div className="text-sm prose prose-sm dark:prose-invert max-w-none mt-1 border-t border-neutral-200 dark:border-neutral-700 pt-3">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentModal.data.skill}</ReactMarkdown>
                  </div>
                </details>
                {/* Role Rules - collapsed by default */}
                {agentModal.data.roleRules && (
                <details>
                  <summary className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase cursor-pointer select-none py-1 hover:text-neutral-700 dark:hover:text-neutral-300">{agentModal.data.isManager ? 'Manager' : 'Worker'} Rules — {agentModal.data.isManager ? 'manager' : 'worker'}.md</summary>
                  <div className="text-sm prose prose-sm dark:prose-invert max-w-none mt-1 border-t border-neutral-200 dark:border-neutral-700 pt-3">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentModal.data.roleRules}</ReactMarkdown>
                  </div>
                </details>
                )}
                {/* Shared Rules - collapsed by default */}
                {agentModal.data.everyone && (
                <details>
                  <summary className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase cursor-pointer select-none py-1 hover:text-neutral-700 dark:hover:text-neutral-300">Shared Rules — everyone.md</summary>
                  <div className="text-sm prose prose-sm dark:prose-invert max-w-none mt-1 border-t border-neutral-200 dark:border-neutral-700 pt-3">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentModal.data.everyone}</ReactMarkdown>
                  </div>
                </details>
                )}
              </div>
              ) : (
              <div className="space-y-3">
                {agentModal.data.workspaceFiles?.length > 0 ? (
                  agentModal.data.workspaceFiles.map((file, i) => (
                    <details key={file.name} open={i === 0}>
                      <summary className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase cursor-pointer select-none py-1 hover:text-neutral-700 dark:hover:text-neutral-300 flex items-center justify-between">
                        <span>{file.name}</span>
                        <span className="text-[10px] font-normal normal-case">{new Date(file.modified).toLocaleString()}</span>
                      </summary>
                      {file.content && (
                        <div className="text-sm prose prose-sm prose-neutral dark:prose-invert max-w-none mt-1 border-t border-neutral-200 dark:border-neutral-700 pt-3 [&_pre]:bg-transparent [&_pre]:p-0 [&_pre]:border-0">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{file.content}</ReactMarkdown>
                        </div>
                      )}
                    </details>
                  ))
                ) : (
                  <p className="text-neutral-400 dark:text-neutral-500 italic py-4 text-center">No workspace files</p>
                )}
              </div>
              )}
            </div>
          ) : (
            <p className="text-neutral-400 dark:text-neutral-500 text-center py-8">Failed to load agent details</p>
          )}
        </PanelContent>
      </Panel>

      {/* Agent Settings Modal */}
      <Modal open={agentSettingsModal.open} onClose={() => setAgentSettingsModal({ ...agentSettingsModal, open: false })}>
        <ModalHeader onClose={() => setAgentSettingsModal({ ...agentSettingsModal, open: false })}>
          <Settings className="w-4 h-4 inline mr-2" />
          <span className="capitalize">{agentSettingsModal.agent?.name}</span> Settings
        </ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-300 mb-1">Model</label>
              <select
                className="w-full px-3 py-2 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded-md text-sm dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={agentSettingsModal.model}
                onChange={(e) => setAgentSettingsModal(prev => ({ ...prev, model: e.target.value }))}
              >
                <option value="">Inherited from global</option>
                <option value="high">⚡ High (deep reasoning)</option>
                <option value="mid">● Mid (default)</option>
                <option value="low">○ Low (fast/cheap)</option>
              </select>
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Leave empty to use the project's default model.</p>
            </div>
            {agentSettingsModal.error && (
              <p className="text-sm text-red-600 dark:text-red-400">{agentSettingsModal.error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAgentSettingsModal({ ...agentSettingsModal, open: false })}>Cancel</Button>
              <Button onClick={saveAgentSettings} disabled={agentSettingsModal.saving}>
                {agentSettingsModal.saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>

      {/* Bootstrap Panel */}
      <BootstrapPanel
        bootstrapModal={bootstrapModal}
        setBootstrapModal={setBootstrapModal}
        executeBootstrap={executeBootstrap}
      />

      {/* Budget Info Modal */}
      <Modal open={budgetInfoModal} onClose={() => setBudgetInfoModal(false)}>
        <ModalHeader onClose={() => setBudgetInfoModal(false)}>
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

      {/* Interval Info Modal */}
      <Modal open={intervalInfoModal} onClose={() => setIntervalInfoModal(false)}>
        <ModalHeader onClose={() => setIntervalInfoModal(false)}>
          Interval
        </ModalHeader>
        <ModalContent>
          <div className="space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
            <p>The <strong>minimum time</strong> between cycles. After all agents complete a cycle, the orchestrator waits at least this long before starting the next cycle.</p>
            <p>If a budget is configured, the actual interval may be longer to stay within the budget limit. The interval acts as a floor — never shorter, but can be longer.</p>
            <p><strong>No delay</strong> means cycles run back-to-back (only useful with budget control).</p>
          </div>
        </ModalContent>
      </Modal>

      {/* Timeout Info Modal */}
      <Modal open={timeoutInfoModal} onClose={() => setTimeoutInfoModal(false)}>
        <ModalHeader onClose={() => setTimeoutInfoModal(false)}>
          Agent Timeout
        </ModalHeader>
        <ModalContent>
          <div className="space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
            <p>The <strong>maximum time</strong> an individual agent is allowed to run before being killed.</p>
            <p>If an agent exceeds this limit, it will be forcefully terminated and the orchestrator moves to the next agent.</p>
            <p><strong>Never</strong> means no timeout — agents run until they complete naturally. Use with caution as stuck agents can block the entire cycle.</p>
          </div>
        </ModalContent>
      </Modal>

      {/* API Key Help Modal */}
      <ApiKeyHelpModal open={showApiKeyHelp} onClose={() => setShowApiKeyHelp(false)} />

      {/* Create Issue Modal */}
      <Modal open={createIssueModal.open} onClose={() => setCreateIssueModal(prev => ({ ...prev, open: false }))}>
        <ModalHeader onClose={() => setCreateIssueModal(prev => ({ ...prev, open: false }))}>
          Create Issue
        </ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            {createIssueModal.error && (
              <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm">
                {createIssueModal.error}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Title</label>
              <input
                type="text"
                placeholder="Short description of the issue"
                className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                value={createIssueModal.title}
                onChange={(e) => setCreateIssueModal(prev => ({ ...prev, title: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('create-issue-body')?.focus() } }}
                onFocus={() => setCreateIssueModal(prev => ({ ...prev, focusedField: 'title' }))}
                disabled={createIssueModal.creating}
                autoFocus
              />
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Created as a human issue in the project database</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Description <span className="text-neutral-400 font-normal">{createIssueModal.focusedField === 'title' ? `(optional, Enter to move here)` : '(optional)'}</span></label>
              <textarea
                id="create-issue-body"
                placeholder="Additional details, context, acceptance criteria..."
                className="w-full px-3 py-2 border rounded-md min-h-[100px] bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                value={createIssueModal.body}
                onChange={(e) => setCreateIssueModal(prev => ({ ...prev, body: e.target.value }))}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') createIssue() }}
                onFocus={() => setCreateIssueModal(prev => ({ ...prev, focusedField: 'body' }))}
                disabled={createIssueModal.creating}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Receiver <span className="text-neutral-400 font-normal">(optional)</span></label>
              <select
                className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                value={createIssueModal.receiver}
                onChange={(e) => setCreateIssueModal(prev => ({ ...prev, receiver: e.target.value }))}
                disabled={createIssueModal.creating}
              >
                <option value="">None (visible to all)</option>
                {[...agents.managers, ...agents.workers].map(a => (
                  <option key={a.name} value={a.name}>{a.name}{a.role ? ` (${a.role})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateIssueModal(prev => ({ ...prev, open: false }))}>Cancel</Button>
              <Button onClick={createIssue} disabled={!createIssueModal.title.trim() || createIssueModal.creating}>
                {createIssueModal.creating ? 'Creating...' : createIssueModal.focusedField === 'body' ? `Create (${modKey}+Enter)` : 'Create'}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>

      {/* Issue Detail Modal */}
      <Panel id="issue-detail" open={issueModal.open} onClose={() => setIssueModal({ ...issueModal, open: false })}>
        <PanelHeader onClose={() => setIssueModal({ ...issueModal, open: false })}>
          {issueModal.issue ? `#${issueModal.issue.id} ${issueModal.issue.title}` : 'Issue'}
        </PanelHeader>
        <PanelContent>
          {issueModal.loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
            </div>
          ) : issueModal.issue ? (
            <div className="space-y-5">
              {/* Header meta row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <Badge variant={issueModal.issue.status === 'open' ? 'success' : 'secondary'} className="text-xs">{issueModal.issue.status || 'open'}</Badge>
                  {issueModal.issue.labels && issueModal.issue.labels.split(',').map(l => l.trim()).filter(Boolean).map(label => (
                    <Badge key={label} variant="outline" className="text-[10px] text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-700">{label}</Badge>
                  ))}
                </div>
                {isWriteMode && (
                  <Button
                    variant={issueModal.issue.status === 'open' ? 'outline' : 'default'}
                    size="sm"
                    className={`text-xs shrink-0 ${issueModal.issue.status === 'open' ? 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950' : 'text-green-600 dark:text-green-400 border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-950'}`}
                    onClick={async () => {
                      const newStatus = issueModal.issue.status === 'open' ? 'closed' : 'open'
                      try {
                        await authFetch(projectApi(`/issues/${issueModal.issue.id}`), {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: newStatus })
                        })
                        setIssueModal(prev => ({ ...prev, issue: { ...prev.issue, status: newStatus } }))
                        await fetchProjectData()
                      } catch {}
                    }}
                  >{issueModal.issue.status === 'open' ? '✕ Close Issue' : '↻ Reopen Issue'}</Button>
                )}
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                {issueModal.issue.creator && (
                  <>
                    <span className="text-neutral-400 dark:text-neutral-500">Created by</span>
                    <span className="flex items-center gap-1 text-neutral-700 dark:text-neutral-200"><User className="w-3 h-3" />{issueModal.issue.creator}</span>
                  </>
                )}
                {issueModal.issue.assignee && (
                  <>
                    <span className="text-neutral-400 dark:text-neutral-500">Assigned to</span>
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><UserCheck className="w-3 h-3" />{issueModal.issue.assignee}</span>
                  </>
                )}
                <span className="text-neutral-400 dark:text-neutral-500">Created</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(issueModal.issue.created_at).toLocaleString()}</span>
                {issueModal.issue.closed_at && (
                  <>
                    <span className="text-neutral-400 dark:text-neutral-500">Closed</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(issueModal.issue.closed_at).toLocaleString()}</span>
                  </>
                )}
              </div>

              {/* Body */}
              {issueModal.issue.body && (
                <>
                  <Separator />
                  <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{issueModal.issue.body}</ReactMarkdown>
                  </div>
                </>
              )}

              {/* Comments */}
              {issueModal.comments.length > 0 && (
                <>
                  <Separator />
                  <h3 className="text-sm font-semibold text-neutral-600 dark:text-neutral-300 flex items-center gap-2">
                    <span>Comments</span>
                    <Badge variant="outline" className="text-[10px] font-normal">{issueModal.comments.length}</Badge>
                  </h3>
                  <div className="space-y-3">
                    {issueModal.comments.map((comment) => (
                      <div key={comment.id} className="border-b border-neutral-200 dark:border-neutral-700 pb-3 last:border-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Avatar className="w-6 h-6">
                            <AvatarFallback className="bg-gradient-to-br from-blue-400 to-purple-500 text-white text-xs">
                              {(comment.author || '??').slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 capitalize">{comment.author}</span>
                          <span className="text-xs text-neutral-400 dark:text-neutral-500 ml-auto">{new Date(comment.created_at).toLocaleString()}</span>
                        </div>
                        <div className="text-sm text-neutral-700 dark:text-neutral-300 prose prose-sm prose-neutral dark:prose-invert max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripAllMetaBlocks(comment.body)}</ReactMarkdown>
                          {parseScheduleBlock(comment.body) && (
                            <ScheduleDiagram schedule={parseScheduleBlock(comment.body)} />
                          )}
                          <MetaBlockBadges text={comment.body} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Add Comment */}
              {isWriteMode && <>
              <Separator />
              <div className="space-y-2">
                <textarea
                  className="w-full text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-400"
                  rows={3}
                  placeholder="Add a comment..."
                  value={issueModal.newComment || ''}
                  onChange={(e) => setIssueModal(prev => ({ ...prev, newComment: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      submitIssueComment()
                    }
                  }}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!issueModal.newComment?.trim() || issueModal.commenting}
                    onClick={submitIssueComment}
                  >
                    {issueModal.commenting ? 'Posting...' : `Post (${modKey}+↵)`}
                  </Button>
                </div>
              </div>
              </>}
            </div>
          ) : (
            <p className="text-neutral-400 dark:text-neutral-500 text-center py-8">Failed to load issue</p>
          )}
        </PanelContent>
      </Panel>

      {/* Agent Reports Panel */}
      <ReportsPanel
        open={reportsPanelOpen}
        onClose={() => setReportsPanelOpen(false)}
        comments={comments}
        commentsLoading={commentsLoading}
        loadMoreComments={loadMoreComments}
        liveAgentLog={liveAgentLog}
        focusedReportId={focusedReportId}
        setFocusedReportId={setFocusedReportId}
        selectedAgent={selectedAgent}
        clearAgentFilter={clearAgentFilter}
        selectedProject={selectedProject}
      />

      {/* Login Modal */}
      <LoginModal
        open={loginModal}
        onClose={() => { setLoginModal(false); setLoginInput('') }}
        loginInput={loginInput}
        setLoginInput={setLoginInput}
        handleLogin={handleLogin}
      />

      <SettingsPanel
        settingsOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        notificationsEnabled={notificationsEnabled}
        toggleNotifications={toggleNotifications}
        detailedNotifs={detailedNotifs}
        setDetailedNotifs={setDetailedNotifs}
        setShowApiKeyHelp={setShowApiKeyHelp}
        globalTokenInput={globalTokenInput}
        setGlobalTokenInput={setGlobalTokenInput}
        tokenSaving={tokenSaving}
        setTokenSaving={setTokenSaving}
        setHasGlobalToken={setHasGlobalToken}
        setGlobalTokenType={setGlobalTokenType}
        setProviderTokens={setProviderTokens}
        setGlobalTokenPreview={setGlobalTokenPreview}
        setToast={setToast}
        providerTokens={providerTokens}
        codexLoginState={codexLoginState}
        setCodexLoginState={setCodexLoginState}
        authFetch={authFetch}
      />
      {projectSettingsModal}
      {/* Notification Center */}
      <Modal open={notifCenter} onClose={() => setNotifCenter(false)}>
        <ModalHeader>
          <div className="flex items-center justify-between w-full">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-blue-500 hover:text-blue-700">
                Mark all read
              </button>
            )}
          </div>
        </ModalHeader>
        <ModalContent>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {notifList.length === 0 ? (
              <div className="p-8 text-center text-neutral-400 dark:text-neutral-500">
                <BellOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No notifications yet</p>
              </div>
            ) : notifList.map(n => {
              const typeIcons = { milestone: '📌', verified: '✅', 'verify-fail': '❌', phase: '🔄', error: '⚠️', 'agent-done': n.message?.startsWith('✗') ? '✗' : '✓', 'project-complete': '🏁' }
              const icon = typeIcons[n.type] || '📋'
              const isLong = n.message && n.message.length > 120
              const expanded = expandedNotifs.has(n.id)
              const displayMsg = isLong && !expanded ? n.message.slice(0, 120) + '…' : n.message
              const agentMatch = n.type === 'agent-done' && n.message?.match(/^[✓✗]\s+(\S+?):\s(.+)$/s)
              const agentName = agentMatch ? agentMatch[1] : null
              const agentMsg = agentMatch ? agentMatch[2] : displayMsg
              const timeAgoLocal = (ts) => {
                const diff = Date.now() - new Date(ts).getTime()
                if (diff < 60000) return 'just now'
                if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
                if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
                return new Date(ts).toLocaleDateString()
              }
              return (
                <div
                  key={n.id}
                  className={`p-3 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors ${!n.read ? 'bg-blue-50/50 dark:bg-blue-950/30' : ''}`}
                  onClick={() => { markRead(n.id); if (isLong) toggleNotifExpand(n.id) }}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 text-base shrink-0 w-5 text-center">{!n.read ? <span className="inline-block w-2 h-2 rounded-full bg-blue-500" /> : <span className="opacity-60">{icon}</span>}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        {agentName && <span className={`text-sm font-semibold ${!n.read ? 'text-neutral-800 dark:text-neutral-100' : 'text-neutral-600 dark:text-neutral-300'}`}>{agentName}</span>}
                        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">{n.project}</span>
                        <span className="text-[11px] text-neutral-400 dark:text-neutral-500 ml-auto shrink-0">{timeAgoLocal(n.timestamp)}</span>
                      </div>
                      <div className={`text-sm mt-0.5 leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 ${!n.read ? 'text-neutral-700 dark:text-neutral-200' : 'text-neutral-500 dark:text-neutral-400'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {agentName ? (isLong && !expanded ? agentMsg.slice(0, 120) + '…' : agentMsg) : displayMsg}
                        </ReactMarkdown>
                      </div>
                      {isLong && (
                        <button className="text-xs text-blue-500 mt-1" onClick={(e) => { e.stopPropagation(); toggleNotifExpand(n.id) }}>
                          {expanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </ModalContent>
      </Modal>

      {/* Toast notifications */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
          (typeof toast === 'object' ? toast.type : '') === 'error' ? 'bg-red-600 text-white' :
          (typeof toast === 'object' ? toast.type : '') === 'success' ? 'bg-green-600 text-white' :
          'bg-neutral-800 text-white'
        }`}>
          <div className="flex items-center gap-2">
            <span>{typeof toast === 'string' ? toast : toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
          </div>
        </div>
      )}
    </div>
    <PanelSlot />
    </div>
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
