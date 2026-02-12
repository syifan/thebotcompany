import { useState, useEffect, useRef } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Activity, Users, Sparkles, Settings, ScrollText, RefreshCw, Pause, Play, SkipForward, RotateCcw, Square, Save, MessageSquare, X, GitPullRequest, CircleDot, Clock, User, UserCheck, Folder, Plus, Trash2, ArrowLeft, Github, DollarSign, Sun, Moon, Monitor, Filter, Info } from 'lucide-react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

function Footer() {
  return (
    <footer className="mt-12 py-6 border-t border-neutral-200 dark:border-neutral-700">
      <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-sm text-neutral-400 dark:text-neutral-500">
        <span>TheBotCompany</span>
        <span className="hidden sm:inline">·</span>
        <a 
          href="https://github.com/syifan/thebotcompany" 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
        >
          <Github className="w-4 h-4" />
          GitHub
        </a>
      </div>
    </footer>
  )
}

function SleepCountdown({ sleepUntil }) {
  const [remaining, setRemaining] = useState('')
  
  useEffect(() => {
    const update = () => {
      const diff = sleepUntil - Date.now()
      if (diff <= 0) {
        setRemaining('Starting...')
        return
      }
      const mins = Math.floor(diff / 60000)
      const secs = Math.floor((diff % 60000) / 1000)
      setRemaining(`${mins}m ${secs}s`)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [sleepUntil])
  
  return <span className="text-sm font-mono text-blue-600">{remaining}</span>
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
  const [createIssueModal, setCreateIssueModal] = useState({ open: false, title: '', body: '', creating: false, error: null })
  const [agentModal, setAgentModal] = useState({ open: false, agent: null, data: null, loading: false, tab: 'skill' })
  const [bootstrapModal, setBootstrapModal] = useState({ open: false, loading: false, preview: null, error: null, executing: false })
  const [budgetInfoModal, setBudgetInfoModal] = useState(false)
  const [intervalInfoModal, setIntervalInfoModal] = useState(false)
  const [timeoutInfoModal, setTimeoutInfoModal] = useState(false)
  const [logsAutoFollow, setLogsAutoFollow] = useState(true)
  const [projectLoading, setProjectLoading] = useState(false)
  const [toast, setToast] = useState(null)
  const logsRef = useRef(null)
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
        fetch(`${baseApi}/issues`),
        fetch(`${baseApi}/repo`)
      ])
      
      // Verify we're still on the same project before setting state
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
      setIssues((await issuesRes.json()).issues || [])
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
      const res = await fetch(projectApi(`/${action}`), { method: 'POST' })
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
      const res = await fetch(projectApi('/config'), {
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
  
  const fetchComments = async (page = 1, agent = null, append = false) => {
    const currentProject = selectedProjectRef.current
    const baseApi = currentProject ? `/api/projects/${currentProject.id}` : null
    if (!baseApi) return
    setCommentsLoading(true)
    try {
      const params = new URLSearchParams({ page, per_page: 10 })
      if (agent) params.set('author', agent)
      const res = await fetch(`${baseApi}/comments?${params}`)
      if (!res.ok) return
      if (selectedProjectRef.current?.id !== currentProject.id) return
      const data = await res.json()
      if (append) setComments(prev => [...prev, ...data.comments])
      else setComments(data.comments || [])
      setCommentsHasMore(data.hasMore)
      setCommentsPage(page)
    } catch (err) { console.error('Failed to fetch comments:', err) }
    finally { setCommentsLoading(false) }
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
    setBootstrapModal({ open: true, loading: true, preview: null, error: null, executing: false })
    try {
      const res = await fetch(projectApi('/bootstrap'))
      const data = await res.json()
      setBootstrapModal({ open: true, loading: false, preview: data, error: null, executing: false })
    } catch (err) {
      setBootstrapModal({ open: true, loading: false, preview: null, error: err.message, executing: false })
    }
  }

  const executeBootstrap = async () => {
    if (!selectedProject) return
    setBootstrapModal(prev => ({ ...prev, executing: true, error: null }))
    try {
      const res = await fetch(projectApi('/bootstrap'), { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setBootstrapModal({ open: false, loading: false, preview: null, error: null, executing: false })
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
      const text = createIssueModal.body.trim()
        ? `${createIssueModal.title.trim()}\n${createIssueModal.body.trim()}`
        : createIssueModal.title.trim()
      const res = await fetch(projectApi('/issues/create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
      const data = await res.json()
      if (data.success) {
        setCreateIssueModal({ open: false, title: '', body: '', creating: false, error: null })
        await fetchProjectData()
      } else {
        setCreateIssueModal(prev => ({ ...prev, creating: false, error: data.error || 'Failed to create issue' }))
      }
    } catch (err) {
      setCreateIssueModal(prev => ({ ...prev, creating: false, error: err.message }))
    }
  }

  const projectToPath = (project) => {
    if (project.repo) return `/github.com/${project.repo}`
    return `/${project.id}`
  }

  const selectProject = (project) => {
    setSelectedProject(project)
    history.pushState(null, '', projectToPath(project))
    setLogs([])
    setAgents({ workers: [], managers: [] })
    setComments([])
    setCommentsPage(1)
    setPrs([])
    setIssues([])
  }

  const goToProjectList = () => {
    setSelectedProject(null)
    history.pushState(null, '', '/')
  }

  const resetAddProjectModal = () => {
    setAddProjectModal({
      step: null, githubUrl: '', projectId: null, projectPath: null,
      hasSpec: false, specContent: null, whatToBuild: '', successCriteria: '',
      updateSpec: false, error: null,
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
      const res = await fetch('/api/github/create-repo', {
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
    fetch('/api/projects/clone', {
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
      const res = await fetch('/api/projects/clone', {
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
      const res = await fetch('/api/projects/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      // Bootstrap workspace
      try {
        await fetch(`/api/projects/${projectId}/bootstrap`, { method: 'POST' })
      } catch {} // Best effort
      resetAddProjectModal()
      await fetchGlobalStatus()
    } catch (err) {
      setAddProjectModal(prev => ({ ...prev, step: 'confirm', error: err.message }))
    }
  }

  const removeProject = async (projectId) => {
    if (!confirm(`Remove project "${projectId}"?`)) return
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
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
      const commentsInterval = setInterval(() => fetchComments(1, localStorage.getItem('selectedAgent') || null, false), 30000) // Comments every 30s
      const projectDataInterval = setInterval(fetchProjectData, 30000) // Issues/PRs/agents every 30s
      
      return () => {
        clearInterval(logsInterval)
        clearInterval(commentsInterval)
        clearInterval(projectDataInterval)
      }
    }
  }, [selectedProject?.id])

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

  const AgentItem = ({ agent, isManager = false }) => {
    const isActive = selectedProject?.currentAgent === agent.name
    const isSelected = selectedAgent === agent.name
    const runtime = isActive ? selectedProject?.currentAgentRuntime : null
    // Get mode from schedule
    const schedule = selectedProject?.schedule
    const agentSchedule = schedule?.agents?.[agent.name]
    const task = typeof agentSchedule === 'string' ? agentSchedule : agentSchedule?.task || null
    
    return (
      <div className="p-2 rounded bg-neutral-50 dark:bg-neutral-900">
        {/* Row 1: Name + action buttons */}
        <div className="flex items-center justify-between">
          <span className="font-medium text-neutral-800 dark:text-neutral-100 capitalize">{agent.name}{agent.role && <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400 ml-1.5">({agent.role})</span>}</span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => openAgentModal(agent.name)}
              className="p-1 rounded transition-colors hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
              title="View agent details"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => openAgentSettings(agent)}
              className="p-1 rounded transition-colors hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300"
              title="Agent settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (isSelected) clearAgentFilter()
                else selectAgent(agent.name)
              }}
              className={`p-1 rounded transition-colors ${
                isSelected
                  ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                  : 'hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300'
              }`}
              title="Filter comments by agent"
            >
              <Filter className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        {task && <p className="text-xs text-blue-500 dark:text-blue-400 mt-0.5 italic">{task}</p>}
        {/* Row 3: Pills */}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {agent.model && <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs rounded-full">{agent.model}</span>}
          {isActive && (
            <Badge variant="success" className="flex items-center gap-1">
              Active{runtime !== null && <span className="font-mono">{formatRuntime(runtime)}</span>}
            </Badge>
          )}
        </div>
        {/* Row 3: Cost metrics */}
        {(agent.totalCost > 0 || agent.lastCallCost > 0) && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">
            Last: ${(agent.lastCallCost || 0).toFixed(2)} · Avg: ${(agent.avgCallCost || 0).toFixed(2)} · 24h: ${(agent.last24hCost || 0).toFixed(2)} · Total: ${(agent.totalCost || 0).toFixed(2)}
          </p>
        )}
      </div>
    )
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

  // Project listing page (when no project is selected)
  if (!selectedProject) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 sm:mb-8">
            <div className="flex items-start sm:items-center justify-between gap-2">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-neutral-800 dark:text-neutral-100">TheBotCompany</h1>
                <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1 hidden sm:block">Multi-project AI Agent Orchestrator</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={cycleTheme}
                  className="px-2 py-1.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 transition-colors"
                  title={`Theme: ${theme} (click to cycle)`}
                >
                  {theme === 'light' ? <Sun className="w-4 h-4" /> : theme === 'dark' ? <Moon className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                </button>
                <div className="text-xs sm:text-sm text-neutral-400 dark:text-neutral-500 shrink-0">
                  {Math.floor(globalUptime / 3600)}h {Math.floor((globalUptime % 3600) / 60)}m
                </div>
              </div>
            </div>
          </div>

          {/* Project List */}
          <div className="space-y-4">
            {projects.map(project => (
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
                            className="text-xs sm:text-sm text-blue-500 hover:underline truncate block">
                            {project.repo}
                          </a>
                        )}
                      </div>
                    </div>
                    
                    {/* Right: Status + Actions */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 pl-13 sm:pl-0">
                      <div className="text-left sm:text-right">
                        <Badge variant={project.paused ? 'warning' : project.running ? 'success' : project.sleeping ? 'secondary' : 'destructive'}>
                          {project.paused ? 'Paused' : project.running ? (project.currentAgent || 'Running') : project.sleeping ? 'Sleeping' : 'Stopped'}
                        </Badge>
                        <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Cycle {project.cycleCount}</p>
                        {project.cost && project.cost.totalCost > 0 && (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">${project.cost.totalCost.toFixed(2)} · ${project.cost.last24hCost.toFixed(2)}/24h</p>
                        )}
                      </div>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={(e) => { e.stopPropagation(); removeProject(project.id) }}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
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

            <Button onClick={openAddProjectModal} className="w-full" variant="outline">
              <Plus className="w-4 h-4 mr-2" /> Add Project
            </Button>
          </div>

          <Footer />
        </div>

        {/* Add Project Modal */}
        <Modal open={addProjectModal.step !== null} onClose={resetAddProjectModal}>
          <ModalHeader onClose={resetAddProjectModal}>
            Add Project
          </ModalHeader>
          <ModalContent>
            {addProjectModal.error && (
              <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm mb-4">
                {addProjectModal.error}
              </div>
            )}

            {/* Step: URL Input */}
            {(addProjectModal.step === 'url' || addProjectModal.step === 'cloning') && (
              <div className="space-y-4">
                {/* Toggle: Existing vs New */}
                <div className="flex rounded-md overflow-hidden border border-neutral-300 dark:border-neutral-600">
                  <button
                    className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${addProjectModal.repoMode === 'existing' ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900' : 'bg-white text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-700'}`}
                    onClick={() => setAddProjectModal(prev => ({ ...prev, repoMode: 'existing' }))}
                  >Import Existing</button>
                  <button
                    className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${addProjectModal.repoMode === 'new' ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900' : 'bg-white text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-700'}`}
                    onClick={() => setAddProjectModal(prev => ({ ...prev, repoMode: 'new' }))}
                  >Create New</button>
                </div>

                {addProjectModal.repoMode === 'new' ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Owner</label>
                      {addProjectModal.orgsLoading ? (
                        <div className="flex items-center gap-2 py-2 text-sm text-neutral-500"><RefreshCw className="w-4 h-4 animate-spin" /> Loading...</div>
                      ) : (
                        <select
                          className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                          value={addProjectModal.selectedOrg}
                          onChange={(e) => setAddProjectModal(prev => ({ ...prev, selectedOrg: e.target.value }))}
                        >
                          {addProjectModal.orgs.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Repository Name</label>
                      <input
                        type="text"
                        placeholder="my-project"
                        className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                        value={addProjectModal.newRepoName}
                        onChange={(e) => setAddProjectModal(prev => ({ ...prev, newRepoName: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Description <span className="text-neutral-400 font-normal">(optional)</span></label>
                      <input
                        type="text"
                        placeholder="A brief description"
                        className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                        value={addProjectModal.newRepoDescription}
                        onChange={(e) => setAddProjectModal(prev => ({ ...prev, newRepoDescription: e.target.value }))}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="newRepoPrivate"
                        checked={addProjectModal.newRepoPrivate}
                        onChange={(e) => setAddProjectModal(prev => ({ ...prev, newRepoPrivate: e.target.checked }))}
                      />
                      <label htmlFor="newRepoPrivate" className="text-sm text-neutral-700 dark:text-neutral-300">Private repository</label>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={resetAddProjectModal}>Cancel</Button>
                      <Button onClick={createNewRepo} disabled={!addProjectModal.newRepoName.trim() || addProjectModal.creatingRepo}>
                        {addProjectModal.creatingRepo ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Creating...</> : 'Next'}
                      </Button>
                    </div>
                  </>
                ) : addProjectModal.inputMode === 'dropdown' ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Organization / User</label>
                      {addProjectModal.orgsLoading ? (
                        <div className="flex items-center gap-2 py-2 text-sm text-neutral-500"><RefreshCw className="w-4 h-4 animate-spin" /> Loading...</div>
                      ) : (
                        <select
                          className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                          value={addProjectModal.selectedOrg}
                          onChange={(e) => {
                            const org = e.target.value
                            setAddProjectModal(prev => ({ ...prev, selectedOrg: org }))
                            if (org) fetchReposForOrg(org)
                          }}
                          disabled={addProjectModal.step === 'cloning'}
                        >
                          <option value="">Select...</option>
                          {addProjectModal.orgs.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                    </div>
                    {addProjectModal.selectedOrg && (
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Repository</label>
                        {addProjectModal.reposLoading ? (
                          <div className="flex items-center gap-2 py-2 text-sm text-neutral-500"><RefreshCw className="w-4 h-4 animate-spin" /> Loading repos...</div>
                        ) : (
                          <select
                            className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                            value={addProjectModal.selectedRepo}
                            onChange={(e) => setAddProjectModal(prev => ({ ...prev, selectedRepo: e.target.value }))}
                            disabled={addProjectModal.step === 'cloning'}
                          >
                            <option value="">Select a repository...</option>
                            {addProjectModal.repos.map(r => (
                              <option key={r.name} value={r.name}>{r.name}{r.description ? ` — ${r.description}` : ''}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Or <button className="underline hover:text-neutral-700 dark:hover:text-neutral-300" onClick={() => setAddProjectModal(prev => ({ ...prev, inputMode: 'url' }))}>enter a URL manually</button>
                    </p>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">GitHub Repository URL</label>
                      <input
                        type="text"
                        placeholder="https://github.com/username/reponame"
                        className="w-full px-3 py-2 border rounded-md bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                        value={addProjectModal.githubUrl}
                        onChange={(e) => setAddProjectModal(prev => ({ ...prev, githubUrl: e.target.value, error: null }))}
                        disabled={addProjectModal.step === 'cloning'}
                        onKeyDown={(e) => { if (e.key === 'Enter') cloneProject() }}
                      />
                    </div>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Or <button className="underline hover:text-neutral-700 dark:hover:text-neutral-300" onClick={() => setAddProjectModal(prev => ({ ...prev, inputMode: 'dropdown' }))}>select from your repos</button>
                    </p>
                  </>
                )}
                {addProjectModal.repoMode === 'existing' && (
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={resetAddProjectModal}>Cancel</Button>
                    <Button
                      onClick={addProjectModal.inputMode === 'dropdown' ? cloneSelectedRepo : cloneProject}
                      disabled={addProjectModal.step === 'cloning' || (addProjectModal.inputMode === 'dropdown' ? !addProjectModal.selectedRepo : !addProjectModal.githubUrl.trim())}
                    >
                      {addProjectModal.step === 'cloning' ? (
                        <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Cloning...</>
                      ) : (
                        'Next'
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Step: Spec */}
            {addProjectModal.step === 'spec' && (
              <div className="space-y-4">
                <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded text-green-700 dark:text-green-300 text-sm">
                  Repository cloned: <span className="font-mono font-bold">{addProjectModal.projectId}</span>
                </div>

                {addProjectModal.hasSpec ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded">
                      <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">spec.md already exists</p>
                      <p className="text-xs text-blue-600 dark:text-blue-400">This project already has a specification file.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="updateSpec"
                        checked={addProjectModal.updateSpec}
                        onChange={(e) => setAddProjectModal(prev => ({ ...prev, updateSpec: e.target.checked }))}
                      />
                      <label htmlFor="updateSpec" className="text-sm text-neutral-700 dark:text-neutral-300">Update the spec</label>
                    </div>
                    {addProjectModal.updateSpec && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">What do you want to build?</label>
                          <textarea
                            className="w-full px-3 py-2 border rounded-md min-h-[80px] bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                            placeholder="Describe what you want to build..."
                            value={addProjectModal.whatToBuild}
                            onChange={(e) => setAddProjectModal(prev => ({ ...prev, whatToBuild: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">How do you consider the project is success?</label>
                          <textarea
                            className="w-full px-3 py-2 border rounded-md min-h-[80px] bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                            placeholder="Define the success criteria..."
                            value={addProjectModal.successCriteria}
                            onChange={(e) => setAddProjectModal(prev => ({ ...prev, successCriteria: e.target.value }))}
                          />
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-neutral-600 dark:text-neutral-400">
                      No spec.md found. Describe your project so the AI agents know what to work on.
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">What do you want to build?</label>
                      <textarea
                        className="w-full px-3 py-2 border rounded-md min-h-[80px] bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                        placeholder="Describe what you want to build..."
                        value={addProjectModal.whatToBuild}
                        onChange={(e) => setAddProjectModal(prev => ({ ...prev, whatToBuild: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">How do you consider the project is success?</label>
                      <textarea
                        className="w-full px-3 py-2 border rounded-md min-h-[80px] bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                        placeholder="Define the success criteria..."
                        value={addProjectModal.successCriteria}
                        onChange={(e) => setAddProjectModal(prev => ({ ...prev, successCriteria: e.target.value }))}
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-between gap-2">
                  <Button variant="outline" onClick={() => setAddProjectModal(prev => ({ ...prev, step: 'url', error: null }))}>
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button onClick={() => setAddProjectModal(prev => ({ ...prev, step: 'budget', error: null }))}>
                    Next
                  </Button>
                </div>
              </div>
            )}

            {/* Step: Budget */}
            {addProjectModal.step === 'budget' && (
              <div className="space-y-4">
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  Set a daily budget to control API spending. The orchestrator will pace cycles to stay within budget.
                </p>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Daily Budget (USD)</label>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-mono text-neutral-800 dark:text-neutral-200">$</span>
                    <input
                      type="number"
                      min="0"
                      step="20"
                      className="w-32 px-3 py-2 border rounded-md text-lg font-mono dark:bg-neutral-800 dark:border-neutral-600 dark:text-neutral-200"
                      value={addProjectModal.budgetPer24h}
                      onChange={(e) => setAddProjectModal(prev => ({ ...prev, budgetPer24h: e.target.value }))}
                    />
                    <span className="text-sm text-neutral-500 dark:text-neutral-400">per 24 hours</span>
                  </div>
                  <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-2">
                    Set to 0 for unlimited. Recommended: $20-100/day depending on agent count and model.
                  </p>
                </div>
                <div className="flex justify-between gap-2">
                  <Button variant="outline" onClick={() => setAddProjectModal(prev => ({ ...prev, step: 'spec', error: null }))}>
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button onClick={() => setAddProjectModal(prev => ({ ...prev, step: 'confirm', error: null }))}>
                    Next
                  </Button>
                </div>
              </div>
            )}

            {/* Step: Confirm */}
            {addProjectModal.step === 'confirm' && (
              <div className="space-y-4">
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Review before creating:</p>
                <div className="space-y-2 p-3 bg-neutral-50 dark:bg-neutral-900 rounded border border-neutral-200 dark:border-neutral-700">
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500 dark:text-neutral-400">Repository</span>
                    <span className="font-mono text-neutral-800 dark:text-neutral-200">{addProjectModal.projectId}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500 dark:text-neutral-400">Spec</span>
                    <span className="text-neutral-800 dark:text-neutral-200">
                      {addProjectModal.hasSpec && !addProjectModal.updateSpec ? 'Existing (unchanged)' : addProjectModal.whatToBuild ? 'Will be created' : 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500 dark:text-neutral-400">Daily Budget</span>
                    <span className="font-mono text-neutral-800 dark:text-neutral-200">
                      {parseFloat(addProjectModal.budgetPer24h) > 0 ? `$${addProjectModal.budgetPer24h}/day` : 'Unlimited'}
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded text-blue-700 dark:text-blue-300 text-sm">
                  A fresh workspace will be created and the orchestrator will start running agents.
                </div>
                <div className="flex justify-between gap-2">
                  <Button variant="outline" onClick={() => setAddProjectModal(prev => ({ ...prev, step: 'budget', error: null }))}>
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button onClick={finalizeAddProject}>
                    Create Project
                  </Button>
                </div>
              </div>
            )}

            {/* Step: Adding */}
            {addProjectModal.step === 'adding' && (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                <p className="text-sm text-neutral-600 dark:text-neutral-400">Adding project...</p>
              </div>
            )}
          </ModalContent>
        </Modal>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="max-w-7xl mx-auto">
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
            <div className="flex items-center gap-2 pl-8 sm:pl-0">
              <button
                onClick={cycleTheme}
                className="px-2 py-1.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 transition-colors"
                title={`Theme: ${theme} (click to cycle)`}
              >
                {theme === 'light' ? <Sun className="w-4 h-4" /> : theme === 'dark' ? <Moon className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
              </button>
              {repoUrl && (
                <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 rounded text-xs text-neutral-700 dark:text-neutral-300 font-medium inline-flex items-center">
                  <Github className="w-3 h-3 mr-1.5" />
                  GitHub
                </a>
              )}
              {selectedProject.paused ? (
                <button onClick={() => controlAction('resume')} className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded text-xs font-medium inline-flex items-center">
                  <Play className="w-3 h-3 mr-1.5" />
                  Resume
                </button>
              ) : (
                <button onClick={() => controlAction('pause')} className="px-3 py-1.5 bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 rounded text-xs text-neutral-700 dark:text-neutral-300 font-medium inline-flex items-center">
                  <Pause className="w-3 h-3 mr-1.5" />
                  Pause
                </button>
              )}
              <button onClick={openBootstrapModal} className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-medium inline-flex items-center">
                <RotateCcw className="w-3 h-3 mr-1.5" />
                Bootstrap
              </button>
            </div>
          </div>
          
          {/* Project tabs - horizontal scroll on mobile */}
          {projects.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {projects.map(project => (
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
            {/* Row 1: State, Cost & Budget, Config */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* State */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="w-4 h-4" />Orchestrator State</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-600 dark:text-neutral-300">Status</span>
                      <Badge variant={selectedProject.paused ? 'warning' : selectedProject.running ? 'success' : 'destructive'}>
                        {selectedProject.paused && selectedProject.currentAgent ? '⏳ Pausing...' : selectedProject.paused ? '⏸️ Paused' : selectedProject.running ? '▶️ Running' : '⏹️ Stopped'}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-600 dark:text-neutral-300">Cycle</span>
                      <span className="text-2xl font-mono font-bold">{selectedProject.cycleCount}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-600 dark:text-neutral-300">Agent</span>
                      {selectedProject.sleeping ? (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          💤 Sleeping
                          <button onClick={(e) => { e.stopPropagation(); controlAction('skip') }} className="ml-1 hover:text-red-500 cursor-pointer" title="Skip sleep">✕</button>
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{selectedProject.currentAgent || 'None'}</Badge>
                      )}
                    </div>
                    {selectedProject.sleeping && selectedProject.sleepUntil && (
                      <div className="flex justify-between items-center">
                        <span className="text-neutral-600 dark:text-neutral-300">Next cycle</span>
                        <SleepCountdown sleepUntil={selectedProject.sleepUntil} />
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-600 dark:text-neutral-300">Last Cycle</span>
                      <span className="text-sm font-mono">
                        {selectedProject.cost?.lastCycleDuration 
                          ? `${Math.floor(selectedProject.cost.lastCycleDuration / 60000)}m ${Math.floor((selectedProject.cost.lastCycleDuration % 60000) / 1000)}s`
                          : '--'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-600 dark:text-neutral-300">Avg Cycle</span>
                      <span className="text-sm font-mono">
                        {selectedProject.cost?.avgCycleDuration 
                          ? `${Math.floor(selectedProject.cost.avgCycleDuration / 60000)}m ${Math.floor((selectedProject.cost.avgCycleDuration % 60000) / 1000)}s`
                          : '--'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-600 dark:text-neutral-300">Uptime</span>
                      <span className="text-sm font-mono">{Math.floor(globalUptime / 3600)}h {Math.floor((globalUptime % 3600) / 60)}m</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Cost & Budget */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="w-4 h-4" />Cost & Budget</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-600 dark:text-neutral-300">Last Cycle</span>
                      <span className="text-sm font-mono">${(selectedProject.cost?.lastCycleCost || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-600 dark:text-neutral-300">Avg Cycle</span>
                      <span className="text-sm font-mono">${(selectedProject.cost?.avgCycleCost || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-600 dark:text-neutral-300">Last 24h</span>
                      <span className="text-sm font-mono">${(selectedProject.cost?.last24hCost || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-neutral-600 dark:text-neutral-300">Total</span>
                      <span className="text-sm font-mono">${(selectedProject.cost?.totalCost || 0).toFixed(2)}</span>
                    </div>
                    {selectedProject.budget && (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-neutral-600 dark:text-neutral-300">Budget</span>
                          <span className="text-sm font-mono">
                            ${selectedProject.budget.spent24h.toFixed(2)} / ${selectedProject.budget.budgetPer24h.toFixed(2)}
                            <span className="text-neutral-400 ml-1">({selectedProject.budget.percentUsed.toFixed(0)}%)</span>
                          </span>
                        </div>
                        {selectedProject.budget.exhausted && (
                          <div className="p-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-xs font-medium">
                            Budget exhausted — cycle paused until spend rolls off
                          </div>
                        )}
                        {!selectedProject.budget.exhausted && (
                          <div className="flex justify-between items-center">
                            <span className="text-neutral-600 dark:text-neutral-300">Computed interval</span>
                            <span className="text-sm font-mono">
                              {selectedProject.budget.computedSleepMs >= 60000
                                ? `${Math.floor(selectedProject.budget.computedSleepMs / 60000)}m ${Math.floor((selectedProject.budget.computedSleepMs % 60000) / 1000)}s`
                                : `${Math.floor(selectedProject.budget.computedSleepMs / 1000)}s`}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    <div className="pt-2 border-t">
                      <button
                        onClick={() => setBudgetInfoModal(true)}
                        className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
                      >
                        How budget works →
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Config */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Settings className="w-4 h-4" />Configuration</CardTitle>
                </CardHeader>
                <CardContent>
                  {configError && <div className="mb-3 p-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-xs">{configError}</div>}
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <label className="text-neutral-600 dark:text-neutral-300 flex items-center gap-1">
                        Interval
                        <button onClick={() => setIntervalInfoModal(true)} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300">
                          <Info className="w-3 h-3" />
                        </button>
                      </label>
                      <select 
                        className="px-3 py-1.5 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded-md text-sm dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" 
                        value={configForm.cycleIntervalMs} 
                        onChange={(e) => updateConfigField('cycleIntervalMs', Number(e.target.value))}
                      >
                        <option value={0}>No delay</option><option value={300000}>5m</option><option value={600000}>10m</option><option value={1200000}>20m</option><option value={1800000}>30m</option><option value={3600000}>1h</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-neutral-600 dark:text-neutral-300 flex items-center gap-1">
                        Agent Timeout
                        <button onClick={() => setTimeoutInfoModal(true)} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300">
                          <Info className="w-3 h-3" />
                        </button>
                      </label>
                      <select 
                        className="px-3 py-1.5 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded-md text-sm dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" 
                        value={configForm.agentTimeoutMs} 
                        onChange={(e) => updateConfigField('agentTimeoutMs', Number(e.target.value))}
                      >
                        <option value={300000}>5m</option><option value={600000}>10m</option><option value={900000}>15m</option><option value={1800000}>30m</option><option value={3600000}>1h</option><option value={7200000}>2h</option><option value={14400000}>4h</option><option value={0}>Never</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="text-neutral-600 dark:text-neutral-300 flex items-center gap-1">
                        24hr Budget
                        <button onClick={() => setBudgetInfoModal(true)} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300">
                          <Info className="w-3 h-3" />
                        </button>
                      </label>
                      <div className="flex items-center">
                        <button
                          onClick={() => updateConfigField('budgetPer24h', Math.max(0, (configForm.budgetPer24h || 0) - 20))}
                          className="px-2 py-1.5 bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 rounded-l-md text-sm font-medium text-neutral-600 dark:text-neutral-300"
                        >
                          −
                        </button>
                        <div className="px-3 py-1.5 bg-white dark:bg-neutral-800 border-y border-neutral-300 dark:border-neutral-600 text-sm dark:text-neutral-200 text-center min-w-[60px]">
                          {configForm.budgetPer24h ? `$${configForm.budgetPer24h}` : 'off'}
                        </div>
                        <button
                          onClick={() => updateConfigField('budgetPer24h', (configForm.budgetPer24h || 0) + 20)}
                          className="px-2 py-1.5 bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 rounded-r-md text-sm font-medium text-neutral-600 dark:text-neutral-300"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                  {configDirty && (
                    <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-700">
                      <Badge variant="warning">Unsaved</Badge>
                      <button onClick={resetConfig} className="px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
                        Reset
                      </button>
                      <button 
                        onClick={saveConfig} 
                        disabled={configSaving}
                        className="px-3 py-1.5 rounded text-xs font-medium inline-flex items-center bg-blue-500 hover:bg-blue-600 text-white"
                      >
                        <Save className="w-3 h-3 mr-1.5" />{configSaving ? '...' : 'Save'}
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Row 2: Managers, Workers, PRs */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
              {/* Managers */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4" />Managers ({agents.managers.length})</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {agents.managers.map((agent) => <AgentItem key={agent.name} agent={agent} isManager />)}
                    {agents.managers.length === 0 && <p className="text-sm text-neutral-400 dark:text-neutral-500">No managers</p>}
                  </div>
                </CardContent>
              </Card>

              {/* Workers */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Users className="w-4 h-4" />Workers ({agents.workers.length})</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {agents.workers.map((agent) => <AgentItem key={agent.name} agent={agent} />)}
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
            </div>

            {/* Row 3: Agent Reports + Issues */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              {/* Agent Reports */}
              <Card className="flex flex-col h-[500px]">
                <CardHeader className="pb-3 shrink-0">
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />Agent Reports
                      {selectedAgent && (
                        <Badge variant="secondary" className="ml-2 capitalize">
                          {selectedAgent}
                          <button onClick={clearAgentFilter} className="ml-1 hover:text-red-500"><X className="w-3 h-3" /></button>
                        </Badge>
                      )}
                    </span>
                    <span className="text-sm font-normal text-neutral-500 dark:text-neutral-400">{comments.length} loaded</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 flex-1 overflow-hidden">
                  <div className="h-full overflow-y-auto overflow-x-hidden pr-2" onScroll={(e) => {
                    const { scrollTop, scrollHeight, clientHeight } = e.target
                    if (scrollHeight - scrollTop - clientHeight < 100) loadMoreComments()
                  }}>
                    {comments.length === 0 && !commentsLoading && <p className="text-sm text-neutral-400 dark:text-neutral-500 text-center py-8">No reports found</p>}
                    {comments.map((comment, idx) => (
                      <div key={comment.id}>
                        {idx > 0 && <Separator className="my-4" />}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Avatar className="w-6 h-6 sm:w-8 sm:h-8">
                              <AvatarFallback className="bg-gradient-to-br from-blue-400 to-purple-500 text-white text-xs">
                                {(comment.agent || comment.author).slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 capitalize">{comment.agent || comment.author}</span>
                            <span className="text-xs text-neutral-400 dark:text-neutral-500">{new Date(comment.created_at).toLocaleString()}</span>
                          </div>
                          <div className="text-sm text-neutral-700 dark:text-neutral-300 prose prose-sm prose-neutral dark:prose-invert max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.body}</ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    ))}
                    {commentsLoading && (
                      <div className="flex items-center justify-center py-4 gap-2 text-neutral-400 dark:text-neutral-500">
                        <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Loading...</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Issues */}
              <Card className="flex flex-col h-[500px]">
                <CardHeader className="shrink-0"><CardTitle className="flex items-center gap-2"><CircleDot className="w-4 h-4" />Open Issues ({issues.length})</CardTitle></CardHeader>
                <CardContent className="flex-1 flex flex-col overflow-hidden">
                  <div className="space-y-2 flex-1 overflow-y-auto">
                    {issues.map((issue) => (
                      <a key={issue.number} href={`${repoUrl}/issues/${issue.number}`} target="_blank" rel="noopener noreferrer"
                        className="block p-2 bg-neutral-50 dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded cursor-pointer transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-neutral-400 dark:text-neutral-500">#{issue.number}</span>
                          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate">{issue.shortTitle || issue.title}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                          {issue.creator && <span className="flex items-center gap-1"><User className="w-3 h-3" />{issue.creator}</span>}
                          {issue.assignee && <span className="flex items-center gap-1 text-green-600"><UserCheck className="w-3 h-3" />{issue.assignee}</span>}
                        </div>
                      </a>
                    ))}
                    {issues.length === 0 && <p className="text-sm text-neutral-400 dark:text-neutral-500">No open issues</p>}
                  </div>
                  <Separator className="my-3 shrink-0" />
                  <div className="shrink-0">
                    <Button 
                      onClick={() => setCreateIssueModal({ open: true, title: '', body: '', creating: false, error: null })}
                      className="w-full dark:bg-neutral-700 dark:hover:bg-neutral-600 dark:text-neutral-100"
                    >
                      Human Intervention (Create Issue)
                    </Button>
                  </div>
                </CardContent>
              </Card>
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
      <Modal open={agentModal.open} onClose={() => setAgentModal({ ...agentModal, open: false })}>
        <ModalHeader onClose={() => setAgentModal({ ...agentModal, open: false })}>
          <span className="capitalize">{agentModal.agent}</span>
          {agentModal.data?.isManager && <Badge variant="secondary" className="ml-2">Manager</Badge>}
        </ModalHeader>
        <ModalContent>
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
                <div>
                  <h4 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase mb-1">Shared Rules (everyone.md)</h4>
                  <div className="bg-neutral-50 dark:bg-neutral-900 rounded p-3 text-sm prose prose-sm dark:prose-invert max-w-none max-h-64 overflow-y-auto">
                    {agentModal.data.everyone ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentModal.data.everyone}</ReactMarkdown>
                    ) : (
                      <p className="text-neutral-400 dark:text-neutral-500 italic">No shared rules found</p>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase mb-1">Agent Skill ({agentModal.agent}.md)</h4>
                  <div className="bg-neutral-50 dark:bg-neutral-900 rounded p-3 text-sm prose prose-sm dark:prose-invert max-w-none max-h-64 overflow-y-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentModal.data.skill}</ReactMarkdown>
                  </div>
                </div>
              </div>
              ) : (
              <div>
                {agentModal.data.workspaceFiles?.length > 0 ? (
                  <div className="space-y-2">
                    {agentModal.data.workspaceFiles.map((file) => (
                      <div key={file.name} className="bg-neutral-50 dark:bg-neutral-900 rounded p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">{file.name}</span>
                          <span className="text-xs text-neutral-400">{new Date(file.modified).toLocaleString()}</span>
                        </div>
                        {file.content && (
                          <pre className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap max-h-48 overflow-y-auto">{file.content}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-neutral-400 dark:text-neutral-500 italic py-4 text-center">No workspace files</p>
                )}
              </div>
              )}
            </div>
          ) : (
            <p className="text-neutral-400 dark:text-neutral-500 text-center py-8">Failed to load agent details</p>
          )}
        </ModalContent>
      </Modal>

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
                <option value="claude-opus-4-6">claude-opus-4-6</option>
                <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
                <option value="claude-haiku-3-5-20241022">claude-haiku-3.5</option>
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

      {/* Bootstrap Modal */}
      <Modal open={bootstrapModal.open} onClose={() => setBootstrapModal({ ...bootstrapModal, open: false })}>
        <ModalHeader onClose={() => setBootstrapModal({ ...bootstrapModal, open: false })}>
          Bootstrap Workspace
        </ModalHeader>
        <ModalContent>
          {bootstrapModal.loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-neutral-400" />
            </div>
          ) : bootstrapModal.preview && !bootstrapModal.preview.available ? (
            <div className="space-y-4">
              <div className="p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded text-yellow-700 dark:text-yellow-300 text-sm">
                {bootstrapModal.preview.reason || 'Bootstrap is not available for this project.'}
              </div>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setBootstrapModal({ ...bootstrapModal, open: false })}>Close</Button>
              </div>
            </div>
          ) : bootstrapModal.preview ? (
            <div className="space-y-4">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Bootstrap clears the workspace and creates a fresh tracker issue so agents start from a clean slate.
              </p>

              <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded">
                <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">What will be lost</p>
                <ul className="text-sm text-red-700 dark:text-red-300 space-y-1 list-disc list-inside">
                  <li>The entire workspace folder will be emptied — all worker skills, agent notes, and workspace files will be deleted</li>
                  <li>The cycle count will be reset to 1</li>
                </ul>
              </div>

              <div className="p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded">
                <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-1">What will happen</p>
                <ul className="text-sm text-green-700 dark:text-green-300 space-y-1 list-disc list-inside">
                  {bootstrapModal.preview.repo && (
                    <li>A new GitHub tracker issue will be created and set in config</li>
                  )}
                  <li>Agents will start fresh — managers will re-hire workers and plan from scratch</li>
                </ul>
              </div>

              <div className="p-3 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded">
                <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300 mb-1">What will be kept</p>
                <ul className="text-sm text-neutral-500 dark:text-neutral-400 space-y-1 list-disc list-inside">
                  <li>Project configuration (config.yaml) is preserved</li>
                  <li>All repository files, PRs, and issues remain untouched</li>
                  <li>The old tracker issue will not be closed</li>
                </ul>
              </div>

              {bootstrapModal.error && (
                <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm">
                  {bootstrapModal.error}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setBootstrapModal({ ...bootstrapModal, open: false })}>Cancel</Button>
                <Button
                  onClick={executeBootstrap}
                  disabled={bootstrapModal.executing}
                  variant="destructive"
                >
                  {bootstrapModal.executing ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Bootstrapping...</>
                  ) : (
                    'Confirm Bootstrap'
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {bootstrapModal.error && (
                <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm">
                  {bootstrapModal.error}
                </div>
              )}
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setBootstrapModal({ ...bootstrapModal, open: false })}>Close</Button>
              </div>
            </div>
          )}
        </ModalContent>
      </Modal>

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
                onKeyDown={(e) => { if (e.key === 'Enter') createIssue() }}
                disabled={createIssueModal.creating}
                autoFocus
              />
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Will be prefixed with [Human] → [Athena]</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Description <span className="text-neutral-400 font-normal">(optional)</span></label>
              <textarea
                placeholder="Additional details, context, acceptance criteria..."
                className="w-full px-3 py-2 border rounded-md min-h-[100px] bg-white dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                value={createIssueModal.body}
                onChange={(e) => setCreateIssueModal(prev => ({ ...prev, body: e.target.value }))}
                disabled={createIssueModal.creating}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateIssueModal(prev => ({ ...prev, open: false }))}>Cancel</Button>
              <Button onClick={createIssue} disabled={!createIssueModal.title.trim() || createIssueModal.creating}>
                {createIssueModal.creating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>

      {/* Toast notifications */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
          toast.type === 'error' ? 'bg-red-600 text-white' :
          toast.type === 'success' ? 'bg-green-600 text-white' :
          'bg-neutral-800 text-white'
        }`}>
          <div className="flex items-center gap-2">
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
