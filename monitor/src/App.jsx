import { useState, useEffect, useRef } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Activity, Users, Sparkles, Settings, ScrollText, RefreshCw, Pause, Play, SkipForward, RotateCcw, Square, Save, MessageSquare, X, GitPullRequest, CircleDot, Clock, User, UserCheck, Info, Folder } from 'lucide-react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

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
  const [globalStatus, setGlobalStatus] = useState({ uptime: 0, projectCount: 0 })
  
  // Project-specific state
  const [logs, setLogs] = useState([])
  const [agents, setAgents] = useState({ workers: [], managers: [] })
  const [config, setConfig] = useState({ config: null, raw: '' })
  const [configForm, setConfigForm] = useState({
    cycleIntervalMs: 1800000, agentTimeoutMs: 900000, model: 'claude-opus-4-5',
    trackerIssue: 1, athenaCycleInterval: 1, apolloCycleInterval: 1
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
  const [newIssueText, setNewIssueText] = useState('')
  const [creatingIssue, setCreatingIssue] = useState(false)
  const [agentModal, setAgentModal] = useState({ open: false, agent: null, data: null, loading: false })
  const [logsAutoFollow, setLogsAutoFollow] = useState(true)
  const logsRef = useRef(null)

  const projectApi = (path) => selectedProject ? `/api/projects/${selectedProject.id}${path}` : null

  const fetchGlobalStatus = async () => {
    try {
      const res = await fetch('/api/status')
      const data = await res.json()
      setGlobalStatus({ uptime: data.uptime, projectCount: data.projectCount })
      setProjects(data.projects)
      
      // Auto-select first project if none selected
      if (!selectedProject && data.projects.length > 0) {
        const saved = localStorage.getItem('selectedProjectId')
        const found = data.projects.find(p => p.id === saved)
        setSelectedProject(found || data.projects[0])
      } else if (selectedProject) {
        // Update selected project data
        const updated = data.projects.find(p => p.id === selectedProject.id)
        if (updated) setSelectedProject(updated)
      }
      
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  const fetchProjectData = async () => {
    if (!selectedProject) return
    
    try {
      const [logsRes, agentsRes, configRes, prsRes, issuesRes, repoRes] = await Promise.all([
        fetch(projectApi('/logs?lines=100')),
        fetch(projectApi('/agents')),
        fetch(projectApi('/config')),
        fetch(projectApi('/prs')),
        fetch(projectApi('/issues')),
        fetch(projectApi('/repo'))
      ])
      
      setLogs((await logsRes.json()).logs || [])
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
      
      setPrs((await prsRes.json()).prs || [])
      setIssues((await issuesRes.json()).issues || [])
      setRepoUrl((await repoRes.json()).url)
      
      setLastUpdate(new Date())
    } catch (err) {
      console.error('Failed to fetch project data:', err)
    }
  }
  
  const controlAction = async (action) => {
    if (!selectedProject) return
    try {
      const res = await fetch(projectApi(`/${action}`), { method: 'POST' })
      if (res.ok) await fetchGlobalStatus()
    } catch (err) { console.error(`Control action ${action} failed:`, err) }
  }
  
  const saveConfig = async () => {
    if (!selectedProject) return
    setConfigSaving(true)
    setConfigError(null)
    try {
      const yaml = `# ${selectedProject.id} - Orchestrator Configuration
cycleIntervalMs: ${configForm.cycleIntervalMs}
agentTimeoutMs: ${configForm.agentTimeoutMs}
model: ${configForm.model}
trackerIssue: ${configForm.trackerIssue}
athenaCycleInterval: ${configForm.athenaCycleInterval}
apolloCycleInterval: ${configForm.apolloCycleInterval}
`
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
    if (!selectedProject) return
    setCommentsLoading(true)
    try {
      const params = new URLSearchParams({ page, per_page: 10 })
      if (agent) params.set('author', agent)
      const res = await fetch(projectApi(`/comments?${params}`))
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
    setAgentModal({ open: true, agent: agentName, data: null, loading: true })
    try {
      const res = await fetch(projectApi(`/agents/${agentName}`))
      const data = await res.json()
      setAgentModal({ open: true, agent: agentName, data, loading: false })
    } catch (err) {
      setAgentModal({ open: true, agent: agentName, data: null, loading: false })
    }
  }

  const selectProject = (project) => {
    setSelectedProject(project)
    localStorage.setItem('selectedProjectId', project.id)
    // Reset project-specific state
    setLogs([])
    setAgents({ workers: [], managers: [] })
    setComments([])
    setCommentsPage(1)
    setPrs([])
    setIssues([])
  }

  useEffect(() => {
    fetchGlobalStatus()
    const interval = setInterval(fetchGlobalStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (selectedProject) {
      fetchProjectData()
      const savedAgent = localStorage.getItem('selectedAgent')
      fetchComments(1, savedAgent, false)
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

  const AgentItem = ({ agent, isManager = false }) => {
    const isActive = selectedProject?.currentAgent === agent.name
    const isSelected = selectedAgent === agent.name
    const runtime = isActive ? selectedProject?.currentAgentRuntime : null
    
    const handleClick = () => {
      if (isSelected) clearAgentFilter()
      else selectAgent(agent.name)
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
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openAgentModal(agent.name) }}>
            <Info className="w-4 h-4" />
          </Button>
        </div>
      </div>
    )
  }

  const getProjectStatusBadge = (project) => {
    if (project.paused) return <Badge variant="secondary">Paused</Badge>
    if (project.currentAgent) return <Badge variant="success">Running</Badge>
    if (project.sleeping) return <Badge variant="outline">Sleeping</Badge>
    return <Badge variant="destructive">Stopped</Badge>
  }

  if (projects.length === 0) {
    return (
      <div className="min-h-screen bg-neutral-100 flex items-center justify-center">
        <Card className="w-96">
          <CardContent className="pt-6">
            <div className="text-center text-neutral-500">
              <Folder className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No projects configured</p>
              <p className="text-sm mt-2">Add projects with: <code className="bg-neutral-200 px-1 rounded">tbc add</code></p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      {/* Project Tabs */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-4 py-2">
            <span className="text-sm font-medium text-neutral-500">Projects:</span>
            <div className="flex gap-2 flex-wrap">
              {projects.map(project => (
                <button
                  key={project.id}
                  onClick={() => selectProject(project)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                    selectedProject?.id === project.id 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  {project.id}
                  {getProjectStatusBadge(project)}
                </button>
              ))}
            </div>
            <div className="ml-auto text-xs text-neutral-400">
              Uptime: {Math.floor(globalStatus.uptime / 60)}m
            </div>
          </div>
        </div>
      </div>

      {selectedProject && (
        <div className="container mx-auto px-4 py-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-neutral-800 flex items-center gap-2">
                <Activity className="w-6 h-6" />
                {selectedProject.id}
              </h1>
              <p className="text-neutral-500 text-sm mt-1">
                Cycle {selectedProject.cycleCount} • {repoUrl && <a href={repoUrl} target="_blank" className="text-blue-600 hover:underline">GitHub</a>}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectedProject.sleeping && selectedProject.sleepUntil && (
                <div className="flex items-center gap-2 mr-4">
                  <span className="text-sm text-neutral-500">Next cycle:</span>
                  <SleepCountdown sleepUntil={selectedProject.sleepUntil} />
                </div>
              )}
              <Button variant="outline" size="sm" onClick={() => controlAction('skip')} title="Skip current agent or sleep">
                <SkipForward className="w-4 h-4" />
              </Button>
              {selectedProject.paused ? (
                <Button variant="outline" size="sm" onClick={() => controlAction('resume')} title="Resume">
                  <Play className="w-4 h-4" />
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => controlAction('pause')} title="Pause">
                  <Pause className="w-4 h-4" />
                </Button>
              )}
              <span className="text-xs text-neutral-400">Updated: {formatTime(lastUpdate)}</span>
            </div>
          </div>
          
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4">
              {error}
            </div>
          )}

          <div className="grid grid-cols-12 gap-4">
            {/* Left Column: Agents + Config */}
            <div className="col-span-3 space-y-4">
              {/* Managers */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="w-4 h-4" /> Managers
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {agents.managers.map(agent => (
                    <AgentItem key={agent.name} agent={agent} isManager />
                  ))}
                </CardContent>
              </Card>

              {/* Workers */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="w-4 h-4" /> Workers
                    {selectedAgent && (
                      <Button variant="ghost" size="sm" onClick={clearAgentFilter} className="ml-auto">
                        <X className="w-3 h-3 mr-1" /> Clear filter
                      </Button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {agents.workers.length === 0 ? (
                    <p className="text-neutral-400 text-sm">No workers yet</p>
                  ) : (
                    agents.workers.map(agent => <AgentItem key={agent.name} agent={agent} />)
                  )}
                </CardContent>
              </Card>

              {/* Config */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Settings className="w-4 h-4" /> Config
                    {configDirty && <Badge variant="warning">Modified</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <label className="text-xs text-neutral-500">Cycle Interval (ms)</label>
                    <input type="number" value={configForm.cycleIntervalMs}
                      onChange={e => updateConfigField('cycleIntervalMs', parseInt(e.target.value) || 0)}
                      className="w-full px-2 py-1 border rounded text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500">Agent Timeout (ms)</label>
                    <input type="number" value={configForm.agentTimeoutMs}
                      onChange={e => updateConfigField('agentTimeoutMs', parseInt(e.target.value) || 0)}
                      className="w-full px-2 py-1 border rounded text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500">Model</label>
                    <input type="text" value={configForm.model}
                      onChange={e => updateConfigField('model', e.target.value)}
                      className="w-full px-2 py-1 border rounded text-sm" />
                  </div>
                  {configError && <p className="text-red-500 text-xs">{configError}</p>}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveConfig} disabled={!configDirty || configSaving}>
                      <Save className="w-3 h-3 mr-1" /> Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={resetConfig} disabled={!configDirty}>
                      <RotateCcw className="w-3 h-3 mr-1" /> Reset
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Middle Column: Logs */}
            <div className="col-span-5">
              <Card className="h-full">
                <CardHeader className="py-3 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ScrollText className="w-4 h-4" /> Logs
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setLogsAutoFollow(!logsAutoFollow)}>
                    {logsAutoFollow ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
                  </Button>
                </CardHeader>
                <CardContent>
                  <div ref={logsRef} className="h-[600px] overflow-y-auto font-mono text-xs bg-neutral-900 text-neutral-100 p-2 rounded">
                    {logs.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap">{line}</div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Comments + PRs/Issues */}
            <div className="col-span-4 space-y-4">
              {/* Comments */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" /> 
                    Comments
                    {selectedAgent && <Badge>{selectedAgent}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {comments.length === 0 ? (
                      <p className="text-neutral-400 text-sm">No comments yet</p>
                    ) : (
                      comments.map(comment => (
                        <div key={comment.id} className="border-b pb-2">
                          <div className="flex items-center gap-2 mb-1">
                            <Avatar className="w-6 h-6">
                              <AvatarFallback className="text-xs">{comment.agent?.[0]?.toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium text-sm">{comment.agent}</span>
                            <span className="text-xs text-neutral-400">
                              {new Date(comment.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="prose prose-sm max-w-none text-neutral-700">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {comment.body?.slice(0, 500) + (comment.body?.length > 500 ? '...' : '')}
                            </ReactMarkdown>
                          </div>
                        </div>
                      ))
                    )}
                    {commentsHasMore && (
                      <Button variant="outline" size="sm" onClick={loadMoreComments} disabled={commentsLoading} className="w-full">
                        {commentsLoading ? 'Loading...' : 'Load more'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* PRs & Issues */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <GitPullRequest className="w-4 h-4" /> PRs & Issues
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {prs.map(pr => (
                      <a key={pr.number} href={`${repoUrl}/pull/${pr.number}`} target="_blank"
                        className="flex items-center gap-2 text-sm hover:bg-neutral-50 p-1 rounded">
                        <GitPullRequest className="w-4 h-4 text-green-600" />
                        <span className="truncate">{pr.shortTitle || pr.title}</span>
                        {pr.agent && <Badge variant="outline" className="text-xs">{pr.agent}</Badge>}
                      </a>
                    ))}
                    {issues.map(issue => (
                      <a key={issue.number} href={`${repoUrl}/issues/${issue.number}`} target="_blank"
                        className="flex items-center gap-2 text-sm hover:bg-neutral-50 p-1 rounded">
                        <CircleDot className="w-4 h-4 text-purple-600" />
                        <span className="truncate">{issue.shortTitle || issue.title}</span>
                        {issue.assignee && <Badge variant="outline" className="text-xs">{issue.assignee}</Badge>}
                      </a>
                    ))}
                    {prs.length === 0 && issues.length === 0 && (
                      <p className="text-neutral-400 text-sm">No open PRs or issues</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* Agent Modal */}
      <Modal open={agentModal.open} onClose={() => setAgentModal({ open: false, agent: null, data: null, loading: false })}>
        <ModalHeader>{agentModal.agent}</ModalHeader>
        <ModalContent>
          {agentModal.loading ? (
            <p>Loading...</p>
          ) : agentModal.data ? (
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Skill</h4>
                <div className="prose prose-sm max-w-none bg-neutral-50 p-3 rounded max-h-[400px] overflow-y-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{agentModal.data.skill}</ReactMarkdown>
                </div>
              </div>
              {agentModal.data.workspaceFiles?.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Workspace Files</h4>
                  <div className="space-y-2">
                    {agentModal.data.workspaceFiles.map(file => (
                      <details key={file.name} className="border rounded">
                        <summary className="p-2 cursor-pointer hover:bg-neutral-50">{file.name}</summary>
                        {file.content && (
                          <pre className="p-2 bg-neutral-100 text-xs overflow-x-auto">{file.content}</pre>
                        )}
                      </details>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p>Agent not found</p>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}

export default App
