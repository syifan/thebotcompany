import { useState, useEffect, useRef } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Activity, Users, Sparkles, Settings, ScrollText, RefreshCw, Pause, Play, SkipForward, RotateCcw, Square, Save, MessageSquare, X, GitPullRequest, CircleDot, Clock, User, UserCheck, Info } from 'lucide-react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const ORCHESTRATOR_API = '/api/orchestrator'

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
  const [state, setState] = useState({ cycleCount: 0, currentAgentIndex: 0 })
  const [logs, setLogs] = useState([])
  const [agents, setAgents] = useState({ workers: [], managers: [] })
  const [config, setConfig] = useState({ config: null, raw: '' })
  const [configForm, setConfigForm] = useState({
    cycleIntervalMs: 1800000, agentTimeoutMs: 900000, model: 'claude-opus-4-5',
    trackerIssue: 1, athenaCycleInterval: 1, apolloCycleInterval: 1
  })
  const [configDirty, setConfigDirty] = useState(false)
  const configDirtyRef = useRef(false) // Sync ref for immediate dirty check
  const [configError, setConfigError] = useState(null)
  const [configSaving, setConfigSaving] = useState(false)
  const [orchestratorStatus, setOrchestratorStatus] = useState(null)
  const [repoUrl, setRepoUrl] = useState(null)
  const [bootstrapDialog, setBootstrapDialog] = useState({ open: false, loading: false, result: null })
  const [lastUpdate, setLastUpdate] = useState(null)
  const [error, setError] = useState(null)
  const [comments, setComments] = useState([])
  const [commentsPage, setCommentsPage] = useState(1)
  const [commentsHasMore, setCommentsHasMore] = useState(true)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState(() => localStorage.getItem('selectedAgent') || null)
  const [prs, setPrs] = useState([])
  const [issues, setIssues] = useState([])
  const [newIssueText, setNewIssueText] = useState('')
  const [creatingIssue, setCreatingIssue] = useState(false)
  const [agentModal, setAgentModal] = useState({ open: false, agent: null, data: null, loading: false })
  const [logsAutoFollow, setLogsAutoFollow] = useState(true)
  const logsRef = useRef(null)

  const fetchData = async () => {
    try {
      const [stateRes, logsRes, agentsRes, configRes, prsRes, issuesRes] = await Promise.all([
        fetch('/api/state'), fetch('/api/logs?lines=100'), fetch('/api/agents'), fetch('/api/config'),
        fetch('/api/prs'), fetch('/api/issues')
      ])
      if (!stateRes.ok || !logsRes.ok || !agentsRes.ok || !configRes.ok) throw new Error('Failed to fetch')
      setPrs((await prsRes.json()).prs || [])
      setIssues((await issuesRes.json()).issues || [])
      setState(await stateRes.json())
      setLogs((await logsRes.json()).logs)
      setAgents(await agentsRes.json())
      const configData = await configRes.json()
      setConfig(configData)
      if (!configDirtyRef.current && configData.config) {
        setConfigForm({
          cycleIntervalMs: configData.config.cycleIntervalMs ?? 1800000,
          agentTimeoutMs: configData.config.agentTimeoutMs ?? 900000,
          model: configData.config.model || 'claude-opus-4-5',
          trackerIssue: configData.config.trackerIssue ?? 1,
          athenaCycleInterval: configData.config.athenaCycleInterval ?? 1,
          apolloCycleInterval: configData.config.apolloCycleInterval ?? 1
        })
      }
      setLastUpdate(new Date())
      setError(null)
      try {
        const statusRes = await fetch(`${ORCHESTRATOR_API}/status`)
        const statusData = await statusRes.json()
        setOrchestratorStatus(statusData.offline ? null : statusData)
      } catch { setOrchestratorStatus(null) }
      try {
        const repoRes = await fetch('/api/repo')
        const repoData = await repoRes.json()
        setRepoUrl(repoData.url)
      } catch { /* ignore */ }
    } catch (err) { setError(err.message) }
  }
  
  const controlAction = async (action) => {
    try {
      const res = await fetch(`${ORCHESTRATOR_API}/${action}`, { method: 'POST' })
      if (res.ok) await fetchData()
    } catch (err) { console.error(`Control action ${action} failed:`, err) }
  }
  
  const saveConfig = async () => {
    setConfigSaving(true)
    setConfigError(null)
    try {
      const yaml = `# ML Performance Survey - Orchestrator Configuration
cycleIntervalMs: ${configForm.cycleIntervalMs}
agentTimeoutMs: ${configForm.agentTimeoutMs}
model: ${configForm.model}
trackerIssue: ${configForm.trackerIssue}
athenaCycleInterval: ${configForm.athenaCycleInterval}
apolloCycleInterval: ${configForm.apolloCycleInterval}
`
      const res = await fetch('/api/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: yaml })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      configDirtyRef.current = false
      setConfigDirty(false)
      await fetchData()
    } catch (err) { setConfigError(err.message) }
    finally { setConfigSaving(false) }
  }
  
  const updateConfigField = (field, value) => {
    configDirtyRef.current = true // Immediate sync update
    setConfigForm(prev => ({ ...prev, [field]: value }))
    setConfigDirty(true)
    setConfigError(null)
  }
  
  const runBootstrap = async () => {
    setBootstrapDialog(prev => ({ ...prev, loading: true, result: null }))
    try {
      const res = await fetch('/api/bootstrap', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setBootstrapDialog({ open: true, loading: false, result: { success: true, output: data.output } })
        await fetchData()
      } else {
        setBootstrapDialog({ open: true, loading: false, result: { success: false, error: data.error } })
      }
    } catch (err) {
      setBootstrapDialog({ open: true, loading: false, result: { success: false, error: err.message } })
    }
  }

  const resetConfig = () => {
    if (config.config) {
      setConfigForm({
        cycleIntervalMs: config.config.cycleIntervalMs ?? 1800000,
        agentTimeoutMs: config.config.agentTimeoutMs ?? 900000,
        model: config.config.model || 'claude-opus-4-5',
        trackerIssue: config.config.trackerIssue ?? 1,
        athenaCycleInterval: config.config.athenaCycleInterval ?? 1,
        apolloCycleInterval: config.config.apolloCycleInterval ?? 1
      })
    }
    configDirtyRef.current = false
    setConfigDirty(false)
    setConfigError(null)
  }
  
  const fetchComments = async (page = 1, agent = null, append = false) => {
    setCommentsLoading(true)
    try {
      const params = new URLSearchParams({ page, per_page: 10 })
      if (agent) params.set('author', agent)
      const res = await fetch(`/api/comments?${params}`)
      const data = await res.json()
      if (append) setComments(prev => [...prev, ...data.comments])
      else setComments(data.comments)
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
    setAgentModal({ open: true, agent: agentName, data: null, loading: true })
    try {
      const res = await fetch(`/api/agents/${agentName}`)
      const data = await res.json()
      setAgentModal({ open: true, agent: agentName, data, loading: false })
    } catch (err) {
      setAgentModal({ open: true, agent: agentName, data: null, loading: false })
    }
  }
  
  const createIssue = async () => {
    if (!newIssueText.trim() || creatingIssue) return
    setCreatingIssue(true)
    try {
      const res = await fetch('/api/issues/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newIssueText })
      })
      const data = await res.json()
      if (data.success) {
        setNewIssueText('')
        await fetchData()
      } else {
        alert(data.error || 'Failed to create issue')
      }
    } catch (err) {
      alert('Failed to create issue: ' + err.message)
    } finally {
      setCreatingIssue(false)
    }
  }

  useEffect(() => {
    fetchData()
    const savedAgent = localStorage.getItem('selectedAgent')
    fetchComments(1, savedAgent, false)
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [])

  // Auto-scroll logs to bottom when new logs arrive
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

  const AgentItem = ({ agent, isManager = false }) => {
    const isActive = orchestratorStatus?.currentAgent === agent.name
    const isSelected = selectedAgent === agent.name
    const runtime = isActive ? orchestratorStatus?.currentAgentRuntime : null
    
    const handleClick = () => {
      if (isSelected) {
        clearAgentFilter()
      } else {
        selectAgent(agent.name)
      }
    }
    
    return (
      <div
        onClick={handleClick}
        className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
          isActive ? 'bg-blue-50 border border-blue-200' : isSelected ? 'bg-purple-50 border border-purple-200' : 'bg-neutral-50 hover:bg-neutral-100'
        }`}
        title="Click to toggle filter"
      >
        <div className="min-w-0 flex-1">
          <span className="font-medium text-neutral-800 capitalize">{agent.name}</span>
          {agent.role && <p className="text-xs text-neutral-500 truncate">{agent.role}</p>}
        </div>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          {isActive && runtime !== null && (
            <span className="text-xs text-blue-600 flex items-center gap-1">
              <Clock className="w-3 h-3" />{formatRuntime(runtime)}
            </span>
          )}
          {isSelected && <Badge variant="secondary">Filter</Badge>}
          {isActive && <Badge variant="success">Active</Badge>}
          <button
            onClick={(e) => { e.stopPropagation(); openAgentModal(agent.name) }}
            className="p-1 rounded hover:bg-neutral-200 text-neutral-400 hover:text-neutral-600"
            title="View skill"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-2">
          <div>
            <h1 className="text-2xl font-bold text-neutral-800">Agent Monitor</h1>
            <p className="text-sm text-neutral-500">Orchestrator Dashboard</p>
          </div>
          <div className="flex flex-col gap-2 text-sm text-neutral-500">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-4 h-4" />
              <span>Last update: {formatTime(lastUpdate)}</span>
              {error && <Badge variant="warning">Error: {error}</Badge>}
            </div>
            <div className="flex items-center gap-2">
              {repoUrl && (
                <a href={repoUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-1 bg-neutral-200 hover:bg-neutral-300 rounded text-neutral-700 font-medium">
                  GitHub
                </a>
              )}
              <button 
                onClick={() => setBootstrapDialog({ open: true, loading: false, result: null })}
                className="px-3 py-1 bg-red-200 hover:bg-red-300 border border-red-300 rounded text-red-700 font-medium"
              >
                Bootstrap
              </button>
            </div>
          </div>
        </div>

        {/* Row 1: State, Config */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* State */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="w-4 h-4" />Orchestrator State</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-neutral-600">Status</span>
                  {orchestratorStatus ? (
                    <Badge variant={orchestratorStatus.paused ? 'warning' : 'success'}>
                      {orchestratorStatus.paused && orchestratorStatus.currentAgent ? '⏳ Pausing...' : orchestratorStatus.paused ? '⏸️ Paused' : '▶️ Running'}
                    </Badge>
                  ) : <Badge variant="destructive">Offline</Badge>}
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-neutral-600">Cycle</span>
                  <span className="text-2xl font-mono font-bold">{orchestratorStatus?.cycleCount ?? state.cycleCount}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-neutral-600">Agent</span>
                  {orchestratorStatus?.sleeping ? (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      💤 Sleeping
                      <button onClick={(e) => { e.stopPropagation(); controlAction('skip') }} className="ml-1 hover:text-red-500 cursor-pointer" title="Skip sleep">✕</button>
                    </Badge>
                  ) : (
                    <Badge variant="secondary">{orchestratorStatus?.currentAgent || 'None'}</Badge>
                  )}
                </div>
                {orchestratorStatus?.sleeping && orchestratorStatus.sleepUntil && (
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-600">Next cycle</span>
                    <SleepCountdown sleepUntil={orchestratorStatus.sleepUntil} />
                  </div>
                )}
                {orchestratorStatus && (
                  <div className="flex justify-between items-center">
                    <span className="text-neutral-600">Uptime</span>
                    <span className="text-sm font-mono">{Math.floor(orchestratorStatus.uptime / 3600)}h {Math.floor((orchestratorStatus.uptime % 3600) / 60)}m</span>
                  </div>
                )}
                {orchestratorStatus && (
                  <div className="pt-3 border-t flex flex-wrap gap-2">
                    {orchestratorStatus.paused ? (
                      <Button size="sm" onClick={() => controlAction('resume')} className="flex-1"><Play className="w-3 h-3 mr-1" />Resume</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => controlAction('pause')} className="flex-1"><Pause className="w-3 h-3 mr-1" />Pause</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => controlAction('skip')} className="flex-1"><SkipForward className="w-3 h-3 mr-1" />Skip</Button>
                    <Button size="sm" variant="outline" onClick={() => controlAction('reload')}><RotateCcw className="w-3 h-3" /></Button>
                    <Button size="sm" variant="destructive" onClick={() => confirm('Stop?') && controlAction('stop')}><Square className="w-3 h-3" /></Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Config */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2"><Settings className="w-4 h-4" />Configuration</span>
                <div className="flex items-center gap-2">
                  {configDirty && <Badge variant="warning">Unsaved</Badge>}
                  {configDirty && <Button size="sm" variant="ghost" onClick={resetConfig}>Reset</Button>}
                  <Button size="sm" onClick={saveConfig} disabled={!configDirty || configSaving}>
                    <Save className="w-3 h-3 mr-1" />{configSaving ? '...' : 'Save'}
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {configError && <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">{configError}</div>}
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <label className="text-neutral-600">Interval</label>
                  <select className="px-2 py-1 bg-neutral-100 border rounded text-sm" value={configForm.cycleIntervalMs} onChange={(e) => updateConfigField('cycleIntervalMs', Number(e.target.value))}>
                    <option value={0}>No delay</option><option value={300000}>5m</option><option value={600000}>10m</option><option value={1200000}>20m</option><option value={1800000}>30m</option><option value={3600000}>1h</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-neutral-600">Timeout</label>
                  <select className="px-2 py-1 bg-neutral-100 border rounded text-sm" value={configForm.agentTimeoutMs} onChange={(e) => updateConfigField('agentTimeoutMs', Number(e.target.value))}>
                    <option value={300000}>5m</option><option value={600000}>10m</option><option value={900000}>15m</option><option value={1800000}>30m</option><option value={3600000}>1h</option><option value={7200000}>2h</option><option value={14400000}>4h</option><option value={0}>Never</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-neutral-600">Model</label>
                  <select className="px-2 py-1 bg-neutral-100 border rounded text-sm" value={configForm.model} onChange={(e) => updateConfigField('model', e.target.value)}>
                    <option value="claude-sonnet-4-20250514">Sonnet 4</option><option value="claude-opus-4-5">Opus 4.5</option><option value="claude-opus-4-6">Opus 4.6</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

        </div>

        {/* Row 2: Agents, PRs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
          {/* Workers */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Users className="w-4 h-4" />Workers ({agents.workers.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {agents.workers.map((agent) => <AgentItem key={agent.name} agent={agent} />)}
                {agents.workers.length === 0 && <p className="text-sm text-neutral-400">No workers</p>}
              </div>
            </CardContent>
          </Card>

          {/* Managers */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4" />Managers ({agents.managers.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {agents.managers.map((agent) => <AgentItem key={agent.name} agent={agent} isManager />)}
                {agents.managers.length === 0 && <p className="text-sm text-neutral-400">No managers</p>}
              </div>
            </CardContent>
          </Card>

          {/* PRs */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><GitPullRequest className="w-4 h-4" />Open PRs ({prs.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {prs.map((pr) => (
                  <a key={pr.number} href={`${repoUrl}/pull/${pr.number}`} target="_blank" rel="noopener noreferrer"
                    className="block p-2 bg-neutral-50 hover:bg-neutral-100 rounded cursor-pointer transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-neutral-400">#{pr.number}</span>
                      <span className="text-sm font-medium text-neutral-800 truncate">{pr.shortTitle || pr.title}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500">
                      {pr.agent && <span className="flex items-center gap-1"><User className="w-3 h-3" />{pr.agent}</span>}
                      <span className="truncate">{pr.headRefName}</span>
                    </div>
                  </a>
                ))}
                {prs.length === 0 && <p className="text-sm text-neutral-400">No open PRs</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Row 3: Agent Reports + Issues */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          {/* Agent Reports */}
          <Card className="order-2 lg:order-1">
          <CardHeader className="pb-3">
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
              <span className="text-sm font-normal text-neutral-500">{comments.length} loaded</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="max-h-[600px] overflow-y-auto overflow-x-hidden pr-2" onScroll={(e) => {
              const { scrollTop, scrollHeight, clientHeight } = e.target
              if (scrollHeight - scrollTop - clientHeight < 100) loadMoreComments()
            }}>
              {comments.length === 0 && !commentsLoading && <p className="text-sm text-neutral-400 text-center py-8">No reports found</p>}
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
                      <span className="text-sm font-semibold text-neutral-800 capitalize">{comment.agent || comment.author}</span>
                      <span className="text-xs text-neutral-400">{new Date(comment.created_at).toLocaleString()}</span>
                    </div>
                    <div className="text-sm text-neutral-700 prose prose-sm prose-neutral max-w-none prose-headings:mt-3 prose-headings:mb-2 prose-p:my-1 prose-ul:list-disc prose-ul:pl-4 prose-ol:list-decimal prose-ol:pl-4 prose-code:bg-neutral-100 prose-code:px-1 prose-code:rounded prose-pre:bg-neutral-900 prose-pre:text-neutral-100">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.body}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}
              {commentsLoading && (
                <div className="flex items-center justify-center py-4 gap-2 text-neutral-400">
                  <RefreshCw className="w-4 h-4 animate-spin" /><span className="text-sm">Loading...</span>
                </div>
              )}
              {!commentsLoading && commentsHasMore && (
                <div className="pt-4"><Separator className="mb-4" /><Button variant="outline" onClick={loadMoreComments} className="w-full">Load more</Button></div>
              )}
            </div>
          </CardContent>
        </Card>

          {/* Issues */}
          <Card className="order-1 lg:order-2">
            <CardHeader><CardTitle className="flex items-center gap-2"><CircleDot className="w-4 h-4" />Open Issues ({issues.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[500px] overflow-y-auto mb-4">
                {issues.map((issue) => (
                  <a key={issue.number} href={`${repoUrl}/issues/${issue.number}`} target="_blank" rel="noopener noreferrer"
                    className="block p-2 bg-neutral-50 hover:bg-neutral-100 rounded cursor-pointer transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-neutral-400">#{issue.number}</span>
                      <span className="text-sm font-medium text-neutral-800 truncate">{issue.shortTitle || issue.title}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-neutral-500">
                      {issue.creator && (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {issue.creator}
                        </span>
                      )}
                      {issue.assignee && (
                        <span className="flex items-center gap-1 text-green-600">
                          <UserCheck className="w-3 h-3" />
                          {issue.assignee}
                        </span>
                      )}
                    </div>
                    {issue.labels?.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {issue.labels.slice(0, 3).map((label) => (
                          <span key={label.name} className="text-xs px-1 rounded" style={{backgroundColor: `#${label.color}20`, color: `#${label.color}`}}>{label.name}</span>
                        ))}
                      </div>
                    )}
                  </a>
                ))}
                {issues.length === 0 && <p className="text-sm text-neutral-400">No open issues</p>}
              </div>
              <Separator className="my-4" />
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Describe a new issue..."
                  className="w-full px-3 py-2 border rounded text-sm"
                  value={newIssueText}
                  onChange={(e) => setNewIssueText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createIssue()}
                  disabled={creatingIssue}
                />
                <Button onClick={createIssue} disabled={!newIssueText.trim() || creatingIssue} className="w-full">
                  {creatingIssue ? 'Creating...' : 'Create Issue (AI)'}
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
                // Disable auto-follow if user scrolled up (not at bottom)
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
              <div>
                <h3 className="font-semibold text-sm text-neutral-600 mb-2">Skill Definition</h3>
                <div className="bg-neutral-50 rounded p-3 text-sm prose prose-sm max-w-none max-h-64 overflow-y-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentModal.data.skill}</ReactMarkdown>
                </div>
              </div>
              {agentModal.data.workspaceFiles?.length > 0 && (
                <div>
                  <h3 className="font-semibold text-sm text-neutral-600 mb-2">Workspace Files</h3>
                  <div className="space-y-2">
                    {agentModal.data.workspaceFiles.map((file) => (
                      <div key={file.name} className="bg-neutral-50 rounded p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">{file.name}</span>
                          <span className="text-xs text-neutral-400">{new Date(file.modified).toLocaleString()}</span>
                        </div>
                        {file.content && (
                          <pre className="text-xs text-neutral-600 whitespace-pre-wrap max-h-32 overflow-y-auto">{file.content}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-neutral-400 text-center py-8">Failed to load agent details</p>
          )}
        </ModalContent>
      </Modal>

      {/* Bootstrap Confirmation Dialog */}
      <Modal open={bootstrapDialog.open} onClose={() => setBootstrapDialog({ open: false, loading: false, result: null })}>
        <ModalHeader onClose={() => setBootstrapDialog({ open: false, loading: false, result: null })}>
          Bootstrap Agent System
        </ModalHeader>
        <ModalContent>
          {bootstrapDialog.result ? (
            <div className="space-y-4">
              {bootstrapDialog.result.success ? (
                <>
                  <p className="text-green-600 font-semibold">✓ Bootstrap completed successfully</p>
                  <pre className="bg-neutral-100 p-3 rounded text-xs overflow-x-auto max-h-64 overflow-y-auto">{bootstrapDialog.result.output}</pre>
                </>
              ) : (
                <>
                  <p className="text-red-600 font-semibold">✗ Bootstrap failed</p>
                  <pre className="bg-red-50 p-3 rounded text-xs text-red-800">{bootstrapDialog.result.error}</pre>
                </>
              )}
              <button 
                onClick={() => setBootstrapDialog({ open: false, loading: false, result: null })}
                className="w-full py-2 bg-neutral-200 hover:bg-neutral-300 rounded font-medium"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-neutral-600">This will reset the agent system:</p>
              <ul className="list-disc list-inside text-sm text-neutral-500 space-y-1">
                <li>Stop orchestrator and monitor processes</li>
                <li>Remove temporary files (state.json, logs)</li>
                <li>Clear all workers</li>
                <li>Remove workspace</li>
                <li>Create new tracker issue</li>
              </ul>
              <p className="text-red-600 font-semibold text-sm">⚠️ This action cannot be undone!</p>
              <div className="flex gap-2">
                <button 
                  onClick={() => setBootstrapDialog({ open: false, loading: false, result: null })}
                  className="flex-1 py-2 bg-neutral-200 hover:bg-neutral-300 rounded font-medium"
                  disabled={bootstrapDialog.loading}
                >
                  Cancel
                </button>
                <button 
                  onClick={runBootstrap}
                  disabled={bootstrapDialog.loading}
                  className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white rounded font-medium disabled:opacity-50"
                >
                  {bootstrapDialog.loading ? 'Running...' : 'Confirm Bootstrap'}
                </button>
              </div>
            </div>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}

export default App
