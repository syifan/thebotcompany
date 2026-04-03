import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import DashboardWidget from '@/components/ui/DashboardWidget'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Users, User, Sparkles, Settings, ScrollText, RefreshCw, Pause, Play, RotateCcw, Save, GitPullRequest, ArrowLeft, Github, Bell, ChevronDown, Lock, Unlock } from 'lucide-react'
import { PanelSlot, closeAllPanels } from '@/components/ui/panel'

import Footer from '@/components/layout/Footer'
import { OrchestratorStateCard, CostBudgetCard } from '@/components/project/OrchestratorState'
import WorkerCard from '@/components/project/WorkerCard'
import IssuesSidebar from '@/components/project/IssuesSidebar'
import HumanInterventionCard from '@/components/project/HumanInterventionCard'
import AgentReportsCard from '@/components/project/AgentReportsCard'
import ChatCard from '@/components/project/ChatCard'
import SettingsPanel from '@/components/panels/SettingsPanel'
import NotificationPanel from '@/components/panels/NotificationPanel'
import BootstrapPanel from '@/components/panels/BootstrapPanel'
import ReportsPanel from '@/components/panels/ReportsPanel'
import ChatPanel from '@/components/panels/ChatPanel'
import AgentDetailPanel from '@/components/panels/AgentDetailPanel'
import IssueDetailPanel from '@/components/panels/IssueDetailPanel'
import ProjectSettingsPanel from '@/components/panels/ProjectSettingsPanel'
import LoginModal from '@/components/modals/LoginModal'
import ApiKeyHelpModal from '@/components/modals/ApiKeyHelpModal'
import AgentSettingsModal from '@/components/modals/AgentSettingsModal'
import BudgetInfoModal from '@/components/modals/BudgetInfoModal'
import IntervalInfoModal from '@/components/modals/IntervalInfoModal'
import TimeoutInfoModal from '@/components/modals/TimeoutInfoModal'
import CreateIssueModal from '@/components/modals/CreateIssueModal'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/contexts/NotificationContext'
import { useToast } from '@/contexts/ToastContext'

export default function ProjectView({
  selectedProject,
  setSelectedProject,
  projects,
  selectProject,
  goToProjectList,
  error,
  globalUptime,
  fetchGlobalStatus,
  notifCenter,
  setNotifCenter,
  theme,
  setTheme,
  onAgentChangeRef,
}) {
  const { isWriteMode, handleLogout, setLoginModal, loginModal, loginInput, setLoginInput, handleLogin, authFetch } = useAuth()
  const { unreadCount } = useNotifications()
  const { showToast, toast, setToast } = useToast()

  // Project-specific state
  const [logs, setLogs] = useState([])
  const [agents, setAgents] = useState({ workers: [], managers: [] })
  const [config, setConfig] = useState({ config: null, raw: '' })
  const [prs, setPrs] = useState([])
  const [issues, setIssues] = useState([])
  const [issueFilter, setIssueFilter] = useState('open')
  const [repoUrl, setRepoUrl] = useState(null)
  const [projectLoading, setProjectLoading] = useState(false)
  const [logsAutoFollow, setLogsAutoFollow] = useState(true)
  const logsRef = useRef(null)

  // Config state
  const [configForm, setConfigForm] = useState({
    cycleIntervalMs: 1800000, agentTimeoutMs: 900000, trackerIssue: 1, budgetPer24h: 0
  })
  const [configDirty, setConfigDirty] = useState(false)
  const configDirtyRef = useRef(false)
  const [configError, setConfigError] = useState(null)
  const [configSaving, setConfigSaving] = useState(false)

  // Reports state
  const [comments, setComments] = useState([])
  const [commentsPage, setCommentsPage] = useState(1)
  const [commentsHasMore, setCommentsHasMore] = useState(true)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState(() => localStorage.getItem('selectedAgent') || null)
  const [reportsPanelOpen, setReportsPanelOpen] = useState(false)
  const [focusedReportId, setFocusedReportId] = useState(null)
  const [liveAgentLog, setLiveAgentLog] = useState(null)

  // Scroll to focused report when panel opens
  useEffect(() => {
    if (reportsPanelOpen && focusedReportId) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-report-id="${focusedReportId}"]`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const clearTimer = setTimeout(() => setFocusedReportId(null), 2000)
        return () => clearTimeout(clearTimer)
      }, 350)
      return () => clearTimeout(timer)
    }
  }, [reportsPanelOpen, focusedReportId])

  // Modals
  const [agentModal, setAgentModal] = useState({ open: false, agent: null, data: null, loading: false, tab: 'skill' })
  const [issueModal, setIssueModal] = useState({ open: false, issue: null, comments: [], loading: false })
  const [createIssueModal, setCreateIssueModal] = useState({ open: false, title: '', body: '', receiver: '', creating: false, error: null, focusedField: 'title' })
  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'
  const [bootstrapModal, setBootstrapModal] = useState({ open: false, loading: false, preview: null, error: null, executing: false, removeRoadmap: true, specMode: 'keep', specContent: '', whatToBuild: '', successCriteria: '' })
  const [budgetInfoModal, setBudgetInfoModal] = useState(false)
  const [intervalInfoModal, setIntervalInfoModal] = useState(false)
  const [timeoutInfoModal, setTimeoutInfoModal] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showApiKeyHelp, setShowApiKeyHelp] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [chatPanelOpen, setChatPanelOpen] = useState(false)
  const [chatSession, setChatSession] = useState(null)

  // Project settings (token state now managed inside ProjectSettingsPanel)

  // Agent settings modal
  const [agentSettingsModal, setAgentSettingsModal] = useState({ open: false, agent: null, model: '', saving: false, error: null })
  const [availableModels, setAvailableModels] = useState([])

  // Per-project notification settings
  const [projectNotifs, setProjectNotifs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tbc_project_notifs') || '{}') } catch { return {} }
  })

  const selectedProjectRef = useRef(null)
  useEffect(() => { selectedProjectRef.current = selectedProject }, [selectedProject])

  const projectApi = (path) => selectedProject ? `/api/projects/${selectedProject.id}${path}` : null

  // Fetch project data
  const fetchProjectData = useCallback(async (initial = false) => {
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
      
      if (selectedProjectRef.current?.id !== currentProject.id) return
      
      setLogs((await logsRes.json()).logs || [])
      setAgents(await agentsRes.json())
      
      const configData = await configRes.json()
      setConfig(configData)
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
  }, [showToast])

  const fetchComments = useCallback(async (page = 1, agent = null, append = false, silent = false) => {
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
  }, [])

  // Register agent change callback
  useEffect(() => {
    if (onAgentChangeRef) {
      onAgentChangeRef.current = () => {
        fetchProjectData()
        fetchComments(1, localStorage.getItem('selectedAgent') || null, false)
      }
    }
    return () => { if (onAgentChangeRef) onAgentChangeRef.current = null }
  }, [fetchProjectData, fetchComments, onAgentChangeRef])

  // Fetch on project change
  useEffect(() => {
    if (selectedProject) {
      // Reset state for new project — close all side panels
      closeAllPanels()
      setChatPanelOpen(false)
      setChatSession(null)
      setIssueModal({ open: false, issue: null, comments: [], loading: false })
      setReportsPanelOpen(false)
      setAgentModal({ open: false, agent: null, data: null, loading: false, tab: 'skill' })
      setCreateIssueModal(prev => ({ ...prev, open: false }))
      setProjectSettingsOpen(false)
      setSettingsOpen(false)
      setLogs([])
      setAgents({ workers: [], managers: [] })
      setComments([])
      setCommentsPage(1)
      setPrs([])
      setIssues([])
      setIssueFilter('open')


      fetchProjectData(true)
      const savedAgent = localStorage.getItem('selectedAgent')
      fetchComments(1, savedAgent, false)
      
      const fetchLogs = async () => {
        const api = `/api/projects/${selectedProject.id}/logs?lines=100`
        try {
          const res = await fetch(api)
          if (!res.ok) return
          setLogs((await res.json()).logs || [])
        } catch {}
      }

      const logsInterval = setInterval(fetchLogs, 10000)
      // Longer polling intervals — SSE handles real-time updates
      const commentsInterval = setInterval(() => fetchComments(1, localStorage.getItem('selectedAgent') || null, false, true), 60000)
      const projectDataInterval = setInterval(fetchProjectData, 60000)

      // SSE for instant report updates
      const evtSource = new EventSource('/api/events')
      evtSource.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data)
          if (event.type === 'report-new' && event.project === selectedProject.id) {
            fetchComments(1, localStorage.getItem('selectedAgent') || null, false, true)
          }
        } catch {}
      }
      
      return () => {
        clearInterval(logsInterval)
        clearInterval(commentsInterval)
        clearInterval(projectDataInterval)
        evtSource.close()
      }
    }
  }, [selectedProject?.id])

  // Fetch models on mount
  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(data => {
      if (data.data) setAvailableModels(data.data)
    }).catch(() => {})
  }, [])


  // Poll for live agent log
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
          setLiveAgentLog({ agent: data.agent, model: data.model, keyId: data.keyId, keyLabel: data.keyLabel, startTime: data.startTime, cost: data.cost, usage: data.usage, log: data.log })
        } else {
          setLiveAgentLog(null)
        }
      } catch {}
    }
    fetchAgentLog()
    const interval = setInterval(fetchAgentLog, 3000)
    return () => clearInterval(interval)
  }, [selectedProject?.id, selectedProject?.currentAgent])

  // Auto-scroll logs
  useEffect(() => {
    if (logsAutoFollow && logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight
    }
  }, [logs, logsAutoFollow])

  // Actions
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
      const existing = config.config || {}
      const merged = { ...existing,
        cycleIntervalMs: configForm.cycleIntervalMs,
        agentTimeoutMs: configForm.agentTimeoutMs,
        trackerIssue: configForm.trackerIssue,
      }
      if (configForm.budgetPer24h > 0) merged.budgetPer24h = configForm.budgetPer24h
      else delete merged.budgetPer24h
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

  const loadMoreComments = () => {
    if (!commentsLoading && commentsHasMore) fetchComments(commentsPage + 1, selectedAgent, true)
  }

  const selectAgentFilter = (agent) => {
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
    } catch {
      setAgentModal({ open: true, agent: agentName, data: null, loading: false, tab: 'skill' })
    }
  }

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
    } catch {
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
        const data = await (await fetch(projectApi(`/issues/${issueModal.issue.id}`))).json()
        setIssueModal(prev => ({ ...prev, issue: data.issue, comments: data.comments || [], newComment: '', commenting: false }))
      } else {
        setIssueModal(prev => ({ ...prev, commenting: false }))
      }
    } catch {
      setIssueModal(prev => ({ ...prev, commenting: false }))
    }
  }

  const removeProject = async (projectId) => {
    try {
      const res = await authFetch(`/api/projects/${projectId}`, { method: 'DELETE' })
      if (res.ok) {
        if (selectedProject?.id === projectId) {
          goToProjectList()
        }
        await fetchGlobalStatus()
      }
    } catch (err) {
      console.error('Failed to remove project:', err)
    }
  }

  // Project notification settings helpers
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
  const notifUseGlobal = projNotifSettings.useGlobal !== false

  if (!selectedProject) return null

  return (
    <div className="flex h-screen overflow-hidden">
    <div className="flex-1 min-w-0 bg-neutral-50 dark:bg-neutral-950 p-6 max-w-screen-2xl mx-auto overflow-y-auto">
      <div>
        {/* Header */}
        <div className="mb-6 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={goToProjectList} className="text-neutral-500 dark:text-neutral-400 shrink-0 px-2">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline ml-1">All Projects</span>
              </Button>
              <h1 className="text-lg sm:text-2xl font-bold text-neutral-800 dark:text-neutral-100 truncate">{selectedProject.id}</h1>
            </div>
            
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
              <OrchestratorStateCard
                selectedProject={selectedProject}
                globalUptime={globalUptime}
                controlAction={controlAction}
                isWriteMode={isWriteMode}
              />

              <CostBudgetCard
                selectedProject={selectedProject}
                setBudgetInfoModal={setBudgetInfoModal}
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
              />

              <HumanInterventionCard
                issues={issues}
                openIssueModal={openIssueModal}
                setCreateIssueModal={setCreateIssueModal}
                isWriteMode={isWriteMode}
              />

              {isWriteMode && <ChatCard
                selectedProject={selectedProject}
                onOpenChat={(session) => { setChatSession(session); setChatPanelOpen(true) }}
                onNewChat={(session) => { setChatSession(session); setChatPanelOpen(true) }}
              />}

              <DashboardWidget icon={Sparkles} title={`Managers (${agents.managers.length})`}>
                  <div className="space-y-2">
                    {agents.managers.map((agent) => (
                      <WorkerCard
                        key={agent.name}
                        agent={agent}
                        isManager
                        selectedProject={selectedProject}
                        selectedAgent={selectedAgent}
                        openAgentModal={openAgentModal}
                        openAgentSettings={openAgentSettings}
                        selectAgent={selectAgentFilter}
                        clearAgentFilter={clearAgentFilter}
                      />
                    ))}
                    {agents.managers.length === 0 && <p className="text-sm text-neutral-400 dark:text-neutral-500">No managers</p>}
                  </div>
              </DashboardWidget>

              <DashboardWidget icon={Users} title={`Workers (${agents.workers.length})`}>
                  <div className="space-y-2">
                    {agents.workers.map((agent) => (
                      <WorkerCard
                        key={agent.name}
                        agent={agent}
                        selectedProject={selectedProject}
                        selectedAgent={selectedAgent}
                        openAgentModal={openAgentModal}
                        openAgentSettings={openAgentSettings}
                        selectAgent={selectAgentFilter}
                        clearAgentFilter={clearAgentFilter}
                      />
                    ))}
                    {agents.workers.length === 0 && <p className="text-sm text-neutral-400 dark:text-neutral-500">No workers</p>}
                  </div>
              </DashboardWidget>

              <DashboardWidget icon={GitPullRequest} title={`Open PRs (${prs.length})`}>
                  <div className="space-y-2">
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
              </DashboardWidget>

              <AgentReportsCard
                comments={comments}
                commentsLoading={commentsLoading}
                loadMoreComments={loadMoreComments}
                liveAgentLog={liveAgentLog}
                selectedProject={selectedProject}
                setFocusedReportId={setFocusedReportId}
                setReportsPanelOpen={setReportsPanelOpen}
              />

              <IssuesSidebar
                issues={issues}
                issueFilter={issueFilter}
                setIssueFilter={setIssueFilter}
                openIssueModal={openIssueModal}
                setCreateIssueModal={setCreateIssueModal}
                isWriteMode={isWriteMode}
              />
            </div>

            {/* Logs */}
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

      <AgentDetailPanel agentModal={agentModal} setAgentModal={setAgentModal} />
      <AgentSettingsModal agentSettingsModal={agentSettingsModal} setAgentSettingsModal={setAgentSettingsModal} saveAgentSettings={saveAgentSettings} />
      <BootstrapPanel bootstrapModal={bootstrapModal} setBootstrapModal={setBootstrapModal} executeBootstrap={executeBootstrap} />
      <BudgetInfoModal open={budgetInfoModal} onClose={() => setBudgetInfoModal(false)} />
      <IntervalInfoModal open={intervalInfoModal} onClose={() => setIntervalInfoModal(false)} />
      <TimeoutInfoModal open={timeoutInfoModal} onClose={() => setTimeoutInfoModal(false)} />
      <ApiKeyHelpModal open={showApiKeyHelp} onClose={() => setShowApiKeyHelp(false)} />
      <CreateIssueModal createIssueModal={createIssueModal} setCreateIssueModal={setCreateIssueModal} createIssue={createIssue} agents={agents} modKey={modKey} />
      <IssueDetailPanel
        issueModal={issueModal}
        setIssueModal={setIssueModal}
        isWriteMode={isWriteMode}
        authFetch={authFetch}
        projectApi={projectApi}
        submitIssueComment={submitIssueComment}
        modKey={modKey}
      />
      <ChatPanel
        open={chatPanelOpen}
        onClose={() => setChatPanelOpen(false)}
        selectedProject={selectedProject}
        chatSession={chatSession}
        onSessionCreated={(session) => setChatSession(session)}
        modelTiers={config?.tiers || {}}
      />
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
        setShowApiKeyHelp={setShowApiKeyHelp}
      />
      <ProjectSettingsPanel
        selectedProject={selectedProject}
        projectSettingsOpen={projectSettingsOpen}
        setProjectSettingsOpen={setProjectSettingsOpen}
        setProjSetting={setProjSetting}
        notifUseGlobal={notifUseGlobal}
        projNotifSettings={projNotifSettings}
        setShowApiKeyHelp={setShowApiKeyHelp}
        authFetch={authFetch}
        projectApi={projectApi}
        setToast={showToast}
        isWriteMode={isWriteMode}
        config={config}
        setSelectedProject={setSelectedProject}
        fetchProjectData={fetchProjectData}
        fetchGlobalStatus={fetchGlobalStatus}
        removeProject={removeProject}
      />
      <NotificationPanel
        open={notifCenter}
        onClose={() => setNotifCenter(false)}
      />

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
