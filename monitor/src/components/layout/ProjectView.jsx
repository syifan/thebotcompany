import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import DashboardWidget from '@/components/ui/DashboardWidget'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import SegmentedControl from '@/components/ui/segmented-control'
import StatusPill from '@/components/ui/status-pill'
import { Users, Sparkles, Settings, ScrollText, RefreshCw, Pause, Play, RotateCcw, Save, GitPullRequest, ArrowLeft, Github, Bell, ChevronDown, Lock, Unlock, Stethoscope } from 'lucide-react'
import { PanelSlot, closeAllPanels } from '@/components/ui/panel'

import Footer from '@/components/layout/Footer'
import { OrchestratorStateCard, CostBudgetCard } from '@/components/project/OrchestratorState'
import WorkerCard from '@/components/project/WorkerCard'
import IssuesSidebar from '@/components/project/IssuesSidebar'
import HumanInterventionCard from '@/components/project/HumanInterventionCard'
import AgentReportsCard from '@/components/project/AgentReportsCard'
import MilestoneTreeCard from '@/components/project/MilestoneTreeCard'
import ChatCard from '@/components/project/ChatCard'
import SettingsPanel from '@/components/panels/SettingsPanel'
import NotificationPanel from '@/components/panels/NotificationPanel'
import BootstrapPanel from '@/components/panels/BootstrapPanel'
import ReportsPanel from '@/components/panels/ReportsPanel'
import ChatPanel from '@/components/panels/ChatPanel'
import AgentDetailPanel from '@/components/panels/AgentDetailPanel'
import IssueDetailPanel from '@/components/panels/IssueDetailPanel'
import PRDetailPanel from '@/components/panels/PRDetailPanel'
import MilestoneDetailPanel from '@/components/panels/MilestoneDetailPanel'
import ProjectSettingsPanel from '@/components/panels/ProjectSettingsPanel'
import LoginModal from '@/components/modals/LoginModal'
import ApiKeyHelpModal from '@/components/modals/ApiKeyHelpModal'
import AgentSettingsModal from '@/components/modals/AgentSettingsModal'
import BudgetInfoModal from '@/components/modals/BudgetInfoModal'
import IntervalInfoModal from '@/components/modals/IntervalInfoModal'
import TimeoutInfoModal from '@/components/modals/TimeoutInfoModal'
import CreateIssueModal from '@/components/modals/CreateIssueModal'
import DoctorConfirmModal from '@/components/modals/DoctorConfirmModal'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/contexts/NotificationContext'
import { useToast } from '@/contexts/ToastContext'

function getProjectBasePath(project) {
  if (!project) return null
  return project.repo ? `/github.com/${project.repo}` : `/${project.id}`
}

function buildProjectPath(project, segments = []) {
  const projectBasePath = getProjectBasePath(project)
  if (!projectBasePath) return null
  const normalizedSegments = segments
    .filter(segment => segment !== undefined && segment !== null && segment !== '')
    .map(segment => encodeURIComponent(String(segment)))
  return normalizedSegments.length ? `${projectBasePath}/${normalizedSegments.join('/')}` : projectBasePath
}

function parseProjectPanelPath(pathname, project) {
  const projectBasePath = buildProjectPath(project)
  if (!projectBasePath) return { panel: null, id: null, tab: null }
  const path = pathname.replace(/\/+$/, '')
  if (path === projectBasePath || !path.startsWith(`${projectBasePath}/`)) {
    return { panel: null, id: null, tab: null }
  }
  const suffix = path.slice(projectBasePath.length + 1)
  const [panel, rawId, rawTab] = suffix.split('/')
  return {
    panel: panel || null,
    id: rawId ? decodeURIComponent(rawId) : null,
    tab: rawTab ? decodeURIComponent(rawTab) : null,
  }
}

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
  breakMobileExperience,
  setBreakMobileExperience,
  onAgentChangeRef,
}) {
  const { isWriteMode, handleLogout, setLoginModal, loginModal, loginInput, setLoginInput, handleLogin, authFetch } = useAuth()
  const { unreadCount } = useNotifications()
  const { showToast, toast, setToast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [currentPath, setCurrentPath] = useState(() => (typeof window !== 'undefined' ? window.location.pathname : ''))

  // Project-specific state
  const [logs, setLogs] = useState([])
  const [agents, setAgents] = useState({ workers: [], managers: [] })
  const [config, setConfig] = useState({ config: null, raw: '' })
  const [prs, setPrs] = useState([])
  const [prFilter, setPrFilter] = useState('open')
  const [issues, setIssues] = useState([])
  const [issueFilter, setIssueFilter] = useState('open')
  const [repoUrl, setRepoUrl] = useState(null)
  const [projectLoading, setProjectLoading] = useState(false)
  const [logsAutoFollow, setLogsAutoFollow] = useState(true)
  const logsRef = useRef(null)
  const [doctorConfirmOpen, setDoctorConfirmOpen] = useState(false)
  const [doctorRunning, setDoctorRunning] = useState(false)

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
  const [milestones, setMilestones] = useState([])
  const [selectedAgent, setSelectedAgent] = useState(() => localStorage.getItem('selectedAgent') || null)
  const initialPathPanel = parseProjectPanelPath(currentPath, selectedProject)
  const [reportsPanelOpen, setReportsPanelOpen] = useState(initialPathPanel.panel === 'reports')
  const [focusedReportId, setFocusedReportId] = useState(initialPathPanel.panel === 'reports' ? initialPathPanel.id : null)
  const [liveAgentLog, setLiveAgentLog] = useState(null)

  // Modals
  const [agentModal, setAgentModal] = useState({ open: initialPathPanel.panel === 'agent', agent: initialPathPanel.panel === 'agent' ? initialPathPanel.id : null, data: null, loading: false, tab: initialPathPanel.panel === 'agent' ? (initialPathPanel.tab || 'skill') : 'skill' })
  const [issueModal, setIssueModal] = useState({
    open: initialPathPanel.panel === 'issue',
    issue: null,
    comments: [],
    loading: false,
    requestedId: null,
  })
  const [prModal, setPrModal] = useState({
    open: initialPathPanel.panel === 'pr',
    pr: null,
    loading: false,
    error: null,
    requestedNumber: null,
  })
  const [milestoneModal, setMilestoneModal] = useState({
    open: initialPathPanel.panel === 'milestone',
    milestone: null,
    requestedId: initialPathPanel.panel === 'milestone' ? initialPathPanel.id : null,
  })
  const [createIssueModal, setCreateIssueModal] = useState({ open: false, title: '', body: '', receiver: '', creating: false, error: null, focusedField: 'title' })
  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl'
  const [bootstrapModal, setBootstrapModal] = useState({ open: false, loading: false, preview: null, error: null, executing: false, removeRoadmap: true, specMode: 'keep', specContent: '', whatToBuild: '', successCriteria: '' })
  const [budgetInfoModal, setBudgetInfoModal] = useState(false)
  const [intervalInfoModal, setIntervalInfoModal] = useState(false)
  const [timeoutInfoModal, setTimeoutInfoModal] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(initialPathPanel.panel === 'settings')
  const [showApiKeyHelp, setShowApiKeyHelp] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(initialPathPanel.panel === 'project-settings')
  const [chatPanelOpen, setChatPanelOpen] = useState(initialPathPanel.panel === 'chat')
  const [chatSession, setChatSession] = useState(initialPathPanel.panel === 'chat' ? (initialPathPanel.id === 'new' || !initialPathPanel.id ? { id: null, title: 'New Chat', _temp: true } : { id: initialPathPanel.id }) : null)
  const [chatRefreshToken, setChatRefreshToken] = useState(0)

  const pathPanel = parseProjectPanelPath(currentPath, selectedProject)
  const isSettingsPanelOpen = settingsOpen || pathPanel.panel === 'settings'
  const isProjectSettingsPanelOpen = projectSettingsOpen || pathPanel.panel === 'project-settings'
  const isReportsPanelOpen = reportsPanelOpen || pathPanel.panel === 'reports'
  const isChatPanelOpen = chatPanelOpen || pathPanel.panel === 'chat'
  const isIssuePanelOpen = issueModal.open || pathPanel.panel === 'issue'
  const isPrPanelOpen = prModal.open || pathPanel.panel === 'pr'
  const isMilestonePanelOpen = milestoneModal.open || pathPanel.panel === 'milestone'
  const isAgentPanelOpen = agentModal.open || pathPanel.panel === 'agent'
  const isBootstrapPanelOpen = bootstrapModal.open || pathPanel.panel === 'bootstrap'

  const selectedProjectRef = useRef(null)
  const previousProjectIdRef = useRef(null)
  const issueRequestRef = useRef({ id: 0, controller: null, targetId: null })
  const prRequestRef = useRef({ id: 0, controller: null, targetNumber: null })
  useEffect(() => { selectedProjectRef.current = selectedProject }, [selectedProject])

  const abortIssueRequest = useCallback(() => {
    issueRequestRef.current.controller?.abort()
    issueRequestRef.current.controller = null
    issueRequestRef.current.targetId = null
  }, [])

  const abortPrRequest = useCallback(() => {
    prRequestRef.current.controller?.abort()
    prRequestRef.current.controller = null
    prRequestRef.current.targetNumber = null
  }, [])

  const projectBasePath = getProjectBasePath(selectedProject)

  const navigateProjectPath = useCallback((segments = []) => {
    const next = buildProjectPath(selectedProject, segments)
    if (!next) return
    const livePath = typeof window !== 'undefined' ? window.location.pathname : currentPath
    if (livePath !== next) {
      setCurrentPath(next)
      navigate(next, { replace: true })
    }
  }, [selectedProject, currentPath, navigate])

  const shouldClearCurrentPanelPath = useCallback((panelName) => {
    const livePath = typeof window !== 'undefined' ? window.location.pathname : currentPath
    return parseProjectPanelPath(livePath, selectedProject).panel === panelName
  }, [currentPath, selectedProject])

  const clearPanelPathIfActive = useCallback((panelName) => {
    if (shouldClearCurrentPanelPath(panelName)) navigateProjectPath()
  }, [navigateProjectPath, shouldClearCurrentPanelPath])

  const setBootstrapModalWithUrl = useCallback((updater) => {
    setBootstrapModal(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (prev.open && !next.open && shouldClearCurrentPanelPath('bootstrap')) navigateProjectPath()
      return next
    })
  }, [navigateProjectPath, shouldClearCurrentPanelPath])

  const setIssueModalWithUrl = useCallback((updater) => {
    setIssueModal(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (prev.open && !next.open) {
        abortIssueRequest()
        if (shouldClearCurrentPanelPath('issue')) navigateProjectPath()
        return { ...next, requestedId: null, loading: false }
      }
      return next
    })
  }, [abortIssueRequest, navigateProjectPath, shouldClearCurrentPanelPath])

  const setPrModalWithUrl = useCallback((updater) => {
    setPrModal(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (prev.open && !next.open) {
        abortPrRequest()
        if (shouldClearCurrentPanelPath('pr')) navigateProjectPath()
        return { ...next, requestedNumber: null, loading: false, error: null }
      }
      return next
    })
  }, [abortPrRequest, navigateProjectPath, shouldClearCurrentPanelPath])

  const setAgentModalWithUrl = useCallback((updater) => {
    setAgentModal(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (prev.open && !next.open && shouldClearCurrentPanelPath('agent')) navigateProjectPath()
      return next
    })
  }, [navigateProjectPath, shouldClearCurrentPanelPath])

  const setMilestoneModalWithUrl = useCallback((updater) => {
    setMilestoneModal(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (prev.open && !next.open) {
        if (shouldClearCurrentPanelPath('milestone')) navigateProjectPath()
        return { ...next, requestedId: null }
      }
      return next
    })
  }, [navigateProjectPath, shouldClearCurrentPanelPath])

  const setAgentModalTab = useCallback((nextTab) => {
    setAgentModal(prev => {
      if (!prev.open || !prev.agent || prev.tab === nextTab) return prev
      navigateProjectPath(['agent', prev.agent, nextTab === 'skill' ? null : nextTab])
      return { ...prev, tab: nextTab }
    })
  }, [navigateProjectPath])

  const setProjectSettingsOpenWithUrl = useCallback((value) => {
    setProjectSettingsOpen(prev => {
      const next = typeof value === 'function' ? value(prev) : value
      if (prev && !next && shouldClearCurrentPanelPath('project-settings')) navigateProjectPath()
      return next
    })
  }, [navigateProjectPath, shouldClearCurrentPanelPath])

  const closeSidebarPanels = useCallback(() => {
    abortIssueRequest()
    abortPrRequest()
    setSettingsOpen(false)
    setProjectSettingsOpen(false)
    setBootstrapModal(prev => ({ ...prev, open: false }))
    setReportsPanelOpen(false)
    setChatPanelOpen(false)
    setIssueModal(prev => ({ ...prev, open: false, loading: false, requestedId: null }))
    setPrModal(prev => ({ ...prev, open: false, loading: false, error: null, requestedNumber: null }))
    setMilestoneModal(prev => ({ ...prev, open: false, milestone: null, requestedId: null }))
    setAgentModal(prev => ({ ...prev, open: false }))
  }, [abortIssueRequest, abortPrRequest])

  const openSettingsPanel = useCallback(() => {
    setSettingsOpen(true)
    navigateProjectPath(['settings'])
  }, [navigateProjectPath])

  const closeSettingsPanel = useCallback(() => {
    setSettingsOpen(false)
    clearPanelPathIfActive('settings')
  }, [clearPanelPathIfActive])

  const openProjectSettingsPanel = useCallback(() => {
    setProjectSettingsOpen(true)
    navigateProjectPath(['project-settings'])
  }, [navigateProjectPath])

  const closeProjectSettingsPanel = useCallback(() => {
    setProjectSettingsOpen(false)
    clearPanelPathIfActive('project-settings')
  }, [clearPanelPathIfActive])

  const openReportsPanel = useCallback((reportId = null) => {
    setFocusedReportId(reportId)
    setReportsPanelOpen(true)
    navigateProjectPath(['reports', reportId])
  }, [navigateProjectPath])

  const closeReportsPanel = useCallback(() => {
    setReportsPanelOpen(false)
    clearPanelPathIfActive('reports')
  }, [clearPanelPathIfActive])

  const openChatPanel = useCallback((session) => {
    setChatSession(session)
    setChatPanelOpen(true)
    navigateProjectPath(['chat', session?.id ?? 'new'])
  }, [navigateProjectPath])

  const closeChatPanel = useCallback(() => {
    setChatPanelOpen(false)
    clearPanelPathIfActive('chat')
  }, [clearPanelPathIfActive])

  const openMilestoneModal = useCallback((milestoneId) => {
    const requestedId = String(milestoneId)
    const milestone = milestones.find((item) => String(item.milestone_id) === requestedId) || null
    setMilestoneModal({ open: true, milestone, requestedId })
    navigateProjectPath(['milestone', requestedId])
  }, [milestones, navigateProjectPath])

  // Project settings (token state now managed inside ProjectSettingsPanel)

  // Agent settings modal
  const [agentSettingsModal, setAgentSettingsModal] = useState({ open: false, agent: null, model: '', saving: false, error: null })
  const [availableModels, setAvailableModels] = useState([])

  // Per-project notification settings
  const [projectNotifs, setProjectNotifs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tbc_project_notifs') || '{}') } catch { return {} }
  })

  useEffect(() => {
    setCurrentPath(typeof window !== 'undefined' ? window.location.pathname : location.pathname)
  }, [location.pathname])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPopState = () => setCurrentPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const projectApi = (path) => selectedProject ? `/api/projects/${selectedProject.id}${path}` : null

  // Fetch project data
  const fetchProjectData = useCallback(async (initial = false) => {
    const currentProject = selectedProjectRef.current
    const baseApi = currentProject ? `/api/projects/${currentProject.id}` : null
    if (!baseApi) return
    if (initial) setProjectLoading(true)
    
    try {
      const [logsRes, agentsRes, configRes, prsRes, issuesRes, repoRes, milestonesRes] = await Promise.all([
        fetch(`${baseApi}/logs?lines=100`),
        fetch(`${baseApi}/agents`),
        fetch(`${baseApi}/config`),
        fetch(`${baseApi}/prs?status=${prFilter}`),
        fetch(`${baseApi}/issues`).catch(() => ({ ok: false })),
        fetch(`${baseApi}/repo`),
        fetch(`${baseApi}/milestones`).catch(() => ({ ok: false }))
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
      if (milestonesRes.ok) {
        setMilestones((await milestonesRes.json()).milestones || [])
      } else {
        setMilestones([])
      }
      setRepoUrl((await repoRes.json()).url)
    } catch (err) {
      console.error('Failed to fetch project data:', err)
      if (initial) showToast('Failed to load project data')
    } finally {
      setProjectLoading(false)
    }
  }, [prFilter, showToast])

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
      const previousProjectId = previousProjectIdRef.current
      const switchedProjects = previousProjectId && previousProjectId !== selectedProject.id
      previousProjectIdRef.current = selectedProject.id

      if (switchedProjects) {
        abortIssueRequest()
        abortPrRequest()
        closeAllPanels()
        setChatPanelOpen(false)
        setChatSession(null)
        setIssueModal({ open: false, issue: null, comments: [], loading: false, requestedId: null })
        setReportsPanelOpen(false)
        setAgentModal({ open: false, agent: null, data: null, loading: false, tab: 'skill' })
        setCreateIssueModal(prev => ({ ...prev, open: false }))
        setProjectSettingsOpen(false)
        setSettingsOpen(false)
        setPrModal({ open: false, pr: null, loading: false, error: null, requestedNumber: null })
      }

      setLogs([])
      setAgents({ workers: [], managers: [] })
      setPrFilter('open')
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
          if (event.type === 'agent-log-event' && event.project === selectedProject.id) {
            setLiveAgentLog(prev => {
              if (!prev) return prev
              const nextLog = [...(prev.log || []), event.event].slice(-500)
              return { ...prev, log: nextLog }
            })
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
  }, [selectedProject?.id, abortIssueRequest, abortPrRequest])

  useEffect(() => {
    if (!selectedProject) return
    fetchProjectData()
  }, [selectedProject?.id, prFilter, fetchProjectData])

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
          setLiveAgentLog({ agent: data.agent, model: data.model, keyId: data.keyId, keyLabel: data.keyLabel, visibility: data.visibility, startTime: data.startTime, cost: data.cost, usage: data.usage, log: data.log })
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

  const runDoctor = async () => {
    if (!selectedProject) return
    if (!selectedProject.paused || selectedProject.currentAgent) {
      showToast('Doctor requires the project to be fully paused')
      return
    }
    setDoctorRunning(true)
    try {
      const res = await authFetch(projectApi('/doctor'), { method: 'POST' })
      if (res.ok) {
        showToast('Doctor report generated')
        fetchComments(1, localStorage.getItem('selectedAgent') || null, false, true)
      } else {
        const data = await res.json().catch(() => ({}))
        showToast(data.error || 'Doctor failed')
      }
    } catch (err) {
      showToast(`Doctor failed: ${err.message}`)
    } finally {
      setDoctorRunning(false)
      setDoctorConfirmOpen(false)
    }
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

  const openAgentModal = async (agentName, nextTab = 'skill') => {
    if (!selectedProject) return
    navigateProjectPath(['agent', agentName, nextTab === 'skill' ? null : nextTab])
    setAgentModal({ open: true, agent: agentName, data: null, loading: true, tab: nextTab })
    try {
      const res = await fetch(projectApi(`/agents/${agentName}`))
      const data = await res.json()
      setAgentModal({ open: true, agent: agentName, data, loading: false, tab: nextTab })
    } catch {
      setAgentModal({ open: true, agent: agentName, data: null, loading: false, tab: nextTab })
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
    navigateProjectPath(['bootstrap'])
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
      navigateProjectPath()
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
    const currentProject = selectedProjectRef.current
    if (!currentProject) return
    const requestedId = String(issueId)
    const expectedPath = buildProjectPath(currentProject, ['issue', requestedId])
    abortIssueRequest()
    const controller = new AbortController()
    const requestId = issueRequestRef.current.id + 1
    issueRequestRef.current = { id: requestId, controller, targetId: requestedId }
    setIssueModal(prev => ({
      ...prev,
      open: true,
      issue: null,
      comments: [],
      loading: true,
      requestedId,
    }))
    navigateProjectPath(['issue', issueId])
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/issues/${requestedId}`, { signal: controller.signal })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load issue')
      if (issueRequestRef.current.id !== requestId) return
      if (selectedProjectRef.current?.id !== currentProject.id) return
      if (typeof window !== 'undefined' && window.location.pathname !== expectedPath) return
      setIssueModal({
        open: true,
        issue: data.issue,
        comments: data.comments || [],
        loading: false,
        requestedId,
      })
    } catch (err) {
      if (err.name === 'AbortError') return
      if (issueRequestRef.current.id !== requestId) return
      if (selectedProjectRef.current?.id !== currentProject.id) return
      if (typeof window !== 'undefined' && window.location.pathname !== expectedPath) return
      setIssueModal({
        open: true,
        issue: null,
        comments: [],
        loading: false,
        requestedId,
      })
    } finally {
      if (issueRequestRef.current.id === requestId) issueRequestRef.current.controller = null
    }
  }

  const openPRModal = async (prId) => {
    const currentProject = selectedProjectRef.current
    if (!currentProject) return
    const requestedNumber = String(prId)
    const expectedPath = buildProjectPath(currentProject, ['pr', requestedNumber])
    abortPrRequest()
    const controller = new AbortController()
    const requestId = prRequestRef.current.id + 1
    prRequestRef.current = { id: requestId, controller, targetNumber: requestedNumber }
    setPrModal({ open: true, pr: null, loading: true, error: null, requestedNumber })
    navigateProjectPath(['pr', prId])
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/prs/${requestedNumber}`, { signal: controller.signal })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load PR')
      if (prRequestRef.current.id !== requestId) return
      if (selectedProjectRef.current?.id !== currentProject.id) return
      if (typeof window !== 'undefined' && window.location.pathname !== expectedPath) return
      setPrModal({ open: true, pr: data.pr, loading: false, error: null, requestedNumber })
    } catch (err) {
      if (err.name === 'AbortError') return
      if (prRequestRef.current.id !== requestId) return
      if (selectedProjectRef.current?.id !== currentProject.id) return
      if (typeof window !== 'undefined' && window.location.pathname !== expectedPath) return
      setPrModal({ open: true, pr: null, loading: false, error: err.message, requestedNumber })
    } finally {
      if (prRequestRef.current.id === requestId) prRequestRef.current.controller = null
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

  useEffect(() => {
    if (!selectedProject || !projectBasePath) return

    const { panel, id: panelId, tab: panelTab } = parseProjectPanelPath(currentPath, selectedProject)
    if (!panel) {
      closeSidebarPanels()
      return
    }

    if (panel === 'settings') {
      if (!settingsOpen) setSettingsOpen(true)
      return
    }

    if (panel === 'project-settings') {
      if (!projectSettingsOpen) setProjectSettingsOpen(true)
      return
    }

    if (panel === 'bootstrap') {
      // Guard with live URL check: navigateProjectPath() inside setBootstrapModalWithUrl
      // updates window.location synchronously but React Router state (currentPath) lags
      // one render. Without this guard, the effect re-opens the modal on that stale render.
      if (!bootstrapModal.open && shouldClearCurrentPanelPath('bootstrap')) openBootstrapModal()
      return
    }

    if (panel === 'reports') {
      if (panelId && focusedReportId !== panelId) setFocusedReportId(panelId)
      if (!reportsPanelOpen) setReportsPanelOpen(true)
      return
    }

    if (panel === 'chat') {
      const nextSessionId = panelId || 'new'
      const nextSession = nextSessionId === 'new' ? { id: null, title: 'New Chat', _temp: true } : { id: nextSessionId }
      if (!chatPanelOpen || String(chatSession?.id ?? 'new') !== String(nextSessionId)) {
        setChatSession(nextSession)
        setChatPanelOpen(true)
      }
      return
    }

    const activeIssueId = issueRequestRef.current.targetId ?? issueModal.requestedId
    if (panel === 'issue' && panelId && (!issueModal.open || String(activeIssueId) !== String(panelId))) {
      openIssueModal(panelId)
      return
    }

    const activePrNumber = prRequestRef.current.targetNumber ?? prModal.requestedNumber
    if (panel === 'pr' && panelId && (!prModal.open || String(activePrNumber) !== String(panelId))) {
      openPRModal(panelId)
      return
    }

    const activeMilestoneId = milestoneModal.requestedId
    if (panel === 'milestone' && panelId && (!milestoneModal.open || String(activeMilestoneId) !== String(panelId))) {
      openMilestoneModal(panelId)
      return
    }

    if (panel === 'agent' && panelId) {
      const needsAgentData = agentModal.agent === panelId && !agentModal.loading && !agentModal.data
      if (!agentModal.open || agentModal.agent !== panelId || needsAgentData) {
        openAgentModal(panelId, panelTab || 'skill')
        return
      }
      if ((panelTab || 'skill') !== agentModal.tab) {
        setAgentModal(prev => ({ ...prev, tab: panelTab || 'skill' }))
      }
    }
  }, [
    selectedProject,
    projectBasePath,
    currentPath,
    closeSidebarPanels,
    settingsOpen,
    projectSettingsOpen,
    bootstrapModal.open,
    reportsPanelOpen,
    focusedReportId,
    chatPanelOpen,
    chatSession?.id,
    issueModal.open,
    issueModal.requestedId,
    prModal.open,
    prModal.requestedNumber,
    milestoneModal.open,
    milestoneModal.requestedId,
    agentModal.open,
    agentModal.agent,
    agentModal.tab,
    openBootstrapModal,
    openMilestoneModal,
    shouldClearCurrentPanelPath,
  ])

  useEffect(() => {
    if (!milestoneModal.requestedId) return
    const milestone = milestones.find((item) => String(item.milestone_id) === String(milestoneModal.requestedId))
    if (!milestone) return
    setMilestoneModal(prev => {
      if (String(prev.requestedId) !== String(milestone.milestone_id) || prev.milestone === milestone) return prev
      return { ...prev, milestone }
    })
  }, [milestones, milestoneModal.requestedId])

  useEffect(() => () => {
    abortIssueRequest()
    abortPrRequest()
  }, [abortIssueRequest, abortPrRequest])

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
    <div className="flex-1 min-w-0 bg-neutral-50 dark:bg-neutral-950 px-3 py-4 sm:p-6 max-w-screen-2xl mx-auto overflow-y-auto overflow-x-hidden">
      <div>
        {/* Header */}
        <div className="mb-6 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link
                to="/"
                aria-label="All Projects"
                onClick={(event) => {
                  event.preventDefault()
                  goToProjectList()
                }}
                className="inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400 shrink-0 min-w-10 h-10 px-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline ml-1">All Projects</span>
              </Link>
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
                onClick={openProjectSettingsPanel}
                className="p-1.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 transition-colors"
                title="Project Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              <a href={projectApi('/download')} className="p-1.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 inline-flex items-center" title="Download project data as ZIP">
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
              {isWriteMode && (
                <button
                  onClick={() => setDoctorConfirmOpen(true)}
                  disabled={!selectedProject.paused || selectedProject.currentAgent || doctorRunning}
                  className="p-1.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 transition-colors disabled:opacity-50"
                  title={selectedProject.paused && !selectedProject.currentAgent ? 'Run Doctor' : 'Doctor requires project to be fully paused'}
                >
                  <Stethoscope className="w-4 h-4" />
                </button>
              )}
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
          
          {error && <StatusPill variant="warning">Error: {error}</StatusPill>}
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
                  <StatusPill variant={
                    selectedProject.phase === 'athena' ? 'info' :
                    selectedProject.phase === 'implementation' ? 'success' :
                    selectedProject.phase === 'verification' ? 'warning' : 'meta'
                  }>
                    {selectedProject.phase === 'athena' ? 'Planning' : selectedProject.phase === 'implementation' ? (selectedProject.isFixRound ? 'Fixing' : 'Implementation') : selectedProject.phase === 'verification' ? 'Verification' : selectedProject.phase}
                  </StatusPill>
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
            <div className="grid gap-3 sm:gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 22.5em), 1fr))" }}>
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
                refreshToken={chatRefreshToken}
                onOpenChat={openChatPanel}
                onNewChat={openChatPanel}
              />}

              <AgentReportsCard
                comments={comments}
                commentsLoading={commentsLoading}
                loadMoreComments={loadMoreComments}
                liveAgentLog={liveAgentLog}
                selectedProject={selectedProject}
                setFocusedReportId={setFocusedReportId}
                setReportsPanelOpen={openReportsPanel}
              />

              <MilestoneTreeCard
                milestones={milestones}
                currentMilestoneId={selectedProject?.currentMilestoneId || null}
                onMilestoneClick={openMilestoneModal}
                onPrClick={openPRModal}
              />

              <DashboardWidget icon={GitPullRequest} title={`Agent PRs (${prs.length})`}>
                  <div className="space-y-2">
                    <SegmentedControl
                      value={prFilter}
                      onChange={setPrFilter}
                      options={[
                        { value: 'open', label: 'Open' },
                        { value: 'merged', label: 'Merged' },
                        { value: 'closed', label: 'Closed' },
                        { value: 'all', label: 'All' },
                      ]}
                    />
                    {prs.map((pr) => {
                      const content = (
                        <div className="block p-2 bg-neutral-50 dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-neutral-400 dark:text-neutral-500">#{pr.number}</span>
                            <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate">{pr.shortTitle || pr.title}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500 dark:text-neutral-400 flex-wrap">
                            <span className="truncate">{pr.baseRefName === pr.headRefName ? pr.baseRefName : `${pr.baseRefName} ← ${pr.headRefName}`}</span>
                            {pr.status && <StatusPill variant={pr.status === 'open' ? 'open' : pr.status === 'merged' ? 'merged' : 'closed'}>{pr.status}</StatusPill>}
                            {pr.test_status && <StatusPill variant="meta">tests: {pr.test_status}</StatusPill>}
                            {pr.issueIds?.length > 0 && <span>{pr.issueIds.map(id => `#${id}`).join(', ')}</span>}
                          </div>
                        </div>
                      )
                      return (
                        <button
                          key={pr.number}
                          type="button"
                          onClick={() => openPRModal(pr.number)}
                          className="block w-full text-left cursor-pointer"
                        >
                          {content}
                        </button>
                      )
                    })}
                    {prs.length === 0 && <p className="text-sm text-neutral-400 dark:text-neutral-500">{prFilter === 'open' ? 'No open Agent PRs' : prFilter === 'merged' ? 'No merged Agent PRs' : prFilter === 'closed' ? 'No closed Agent PRs' : 'No Agent PRs'}</p>}
                  </div>
              </DashboardWidget>

              <IssuesSidebar
                issues={issues}
                issueFilter={issueFilter}
                setIssueFilter={setIssueFilter}
                openIssueModal={openIssueModal}
                setCreateIssueModal={setCreateIssueModal}
                isWriteMode={isWriteMode}
              />

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

      <AgentDetailPanel
        agentModal={{ ...agentModal, open: isAgentPanelOpen }}
        setAgentModal={setAgentModalWithUrl}
        onSelectTab={setAgentModalTab}
      />
      <AgentSettingsModal agentSettingsModal={agentSettingsModal} setAgentSettingsModal={setAgentSettingsModal} saveAgentSettings={saveAgentSettings} />
      <BootstrapPanel bootstrapModal={{ ...bootstrapModal, open: isBootstrapPanelOpen }} setBootstrapModal={setBootstrapModalWithUrl} executeBootstrap={executeBootstrap} />
      <BudgetInfoModal open={budgetInfoModal} onClose={() => setBudgetInfoModal(false)} />
      <IntervalInfoModal open={intervalInfoModal} onClose={() => setIntervalInfoModal(false)} />
      <TimeoutInfoModal open={timeoutInfoModal} onClose={() => setTimeoutInfoModal(false)} />
      <DoctorConfirmModal
        open={doctorConfirmOpen}
        onClose={() => setDoctorConfirmOpen(false)}
        onConfirm={runDoctor}
        projectId={selectedProject?.id}
        running={doctorRunning}
      />
      <ApiKeyHelpModal open={showApiKeyHelp} onClose={() => setShowApiKeyHelp(false)} />
      <CreateIssueModal createIssueModal={createIssueModal} setCreateIssueModal={setCreateIssueModal} createIssue={createIssue} agents={agents} modKey={modKey} />
      <IssueDetailPanel
        issueModal={{ ...issueModal, open: isIssuePanelOpen }}
        setIssueModal={setIssueModalWithUrl}
        isWriteMode={isWriteMode}
        authFetch={authFetch}
        projectApi={projectApi}
        submitIssueComment={submitIssueComment}
        modKey={modKey}
      />
      <PRDetailPanel prModal={{ ...prModal, open: isPrPanelOpen }} setPrModal={setPrModalWithUrl} />
      <MilestoneDetailPanel
        milestoneModal={{ ...milestoneModal, open: isMilestonePanelOpen }}
        setMilestoneModal={setMilestoneModalWithUrl}
        onOpenPR={openPRModal}
      />
      <ChatPanel
        open={isChatPanelOpen}
        onClose={closeChatPanel}
        selectedProject={selectedProject}
        chatSession={chatSession}
        onSessionCreated={(session) => {
          setChatRefreshToken(t => t + 1)
          setChatSession(session)
          navigateProjectPath(['chat', session?.id ?? 'new'])
        }}
        chatConfig={{
          keyPool: config?.keyPool || null,
          availableModels: config?.availableModels || {},
        }}
      />
      <ReportsPanel
        open={isReportsPanelOpen}
        onClose={closeReportsPanel}
        onSelectReport={openReportsPanel}
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
        settingsOpen={isSettingsPanelOpen}
        onClose={closeSettingsPanel}
        theme={theme}
        setTheme={setTheme}
        breakMobileExperience={breakMobileExperience}
        setBreakMobileExperience={setBreakMobileExperience}
        setShowApiKeyHelp={setShowApiKeyHelp}
      />
      <ProjectSettingsPanel
        selectedProject={selectedProject}
        projectSettingsOpen={isProjectSettingsPanelOpen}
        setProjectSettingsOpen={setProjectSettingsOpenWithUrl}
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
