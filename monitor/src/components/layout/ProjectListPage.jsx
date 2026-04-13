import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import StatusPill from '@/components/ui/status-pill'
import { Bell, Unlock, Lock, Settings, Plus, Folder, BellOff } from 'lucide-react'
import { PanelSlot } from '@/components/ui/panel'
import { useLocation, useNavigate } from 'react-router-dom'
import Footer from '@/components/layout/Footer'
import SleepCountdown from '@/components/layout/SleepCountdown'
import SettingsPanel from '@/components/panels/SettingsPanel'
import NotificationPanel from '@/components/panels/NotificationPanel'
import LoginModal from '@/components/modals/LoginModal'
import AddProjectModal from '@/components/modals/AddProjectModal'
import ApiKeyHelpModal from '@/components/modals/ApiKeyHelpModal'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/contexts/NotificationContext'

export default function ProjectListPage({
  projects,
  selectProject,
  notifCenter,
  setNotifCenter,
  theme,
  setTheme,
}) {
  const { isWriteMode, handleLogout, setLoginModal, loginModal, loginInput, setLoginInput, handleLogin, authFetch } = useAuth()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()
  const location = useLocation()

  const [showArchived, setShowArchived] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showApiKeyHelp, setShowApiKeyHelp] = useState(false)
  const pendingPanelPathRef = useRef(null)

  const navigateListPath = useCallback((pathname) => {
    const livePath = typeof window !== 'undefined' ? window.location.pathname : location.pathname
    if (livePath !== pathname) navigate(pathname, { replace: true })
  }, [location.pathname, navigate])

  const clearListPathIfActive = useCallback((pathname) => {
    const livePath = typeof window !== 'undefined' ? window.location.pathname : location.pathname
    if (pendingPanelPathRef.current && pendingPanelPathRef.current !== pathname) return
    if (livePath === pathname) navigate('/', { replace: true })
  }, [location.pathname, navigate])

  const openSettingsPanel = useCallback(() => {
    pendingPanelPathRef.current = '/settings'
    setSettingsOpen(true)
    setNotifCenter(false)
    navigateListPath('/settings')
  }, [setNotifCenter, navigateListPath])

  const closeSettingsPanel = useCallback(() => {
    setSettingsOpen(false)
    clearListPathIfActive('/settings')
  }, [clearListPathIfActive])

  const openNotificationsPanel = useCallback(() => {
    pendingPanelPathRef.current = '/notifications'
    setNotifCenter(true)
    setSettingsOpen(false)
    navigateListPath('/notifications')
  }, [setNotifCenter, navigateListPath])

  const closeNotificationsPanel = useCallback(() => {
    setNotifCenter(false)
    clearListPathIfActive('/notifications')
  }, [clearListPathIfActive])

  // Add project modal state
  const [addProjectModal, setAddProjectModal] = useState({
    step: null, githubUrl: '', projectId: null, projectPath: null,
    hasSpec: false, specContent: null, whatToBuild: '', successCriteria: '',
    updateSpec: false, budgetPer24h: 40, error: null,
    orgs: [], repos: [], selectedOrg: '', selectedRepo: '', orgsLoading: false, reposLoading: false,
    inputMode: 'dropdown',
    repoMode: 'existing',
    newRepoName: '', newRepoPrivate: false, newRepoDescription: '', creatingRepo: false,
  })

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

  const openAddProjectModal = () => {
    setAddProjectModal(prev => ({ ...prev, step: 'url', error: null, budgetPer24h: 40, orgs: [], repos: [], selectedOrg: '', selectedRepo: '', orgsLoading: true, inputMode: 'dropdown' }))
    fetch('/api/github/orgs')
      .then(r => r.json())
      .then(data => {
        setAddProjectModal(prev => ({ ...prev, orgs: data.orgs || [], orgsLoading: false, selectedOrg: data.user || '' }))
        if (data.user) fetchReposForOrg(data.user)
      })
      .catch(() => {
        setAddProjectModal(prev => ({ ...prev, orgsLoading: false, inputMode: 'url' }))
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
      try {
        await authFetch(`/api/projects/${projectId}/bootstrap`, { method: 'POST' })
      } catch {}
      resetAddProjectModal()
      // Projects list will auto-refresh via polling in App
    } catch (err) {
      setAddProjectModal(prev => ({ ...prev, step: 'confirm', error: err.message }))
    }
  }

  useEffect(() => {
    if (location.pathname === '/settings') {
      pendingPanelPathRef.current = '/settings'
      setSettingsOpen(true)
      setNotifCenter(false)
      return
    }

    if (location.pathname === '/notifications') {
      pendingPanelPathRef.current = '/notifications'
      setNotifCenter(true)
      setSettingsOpen(false)
      return
    }

    pendingPanelPathRef.current = null
    setSettingsOpen(false)
    setNotifCenter(false)
  }, [location.pathname, setNotifCenter])

  return (
    <div className="flex h-screen overflow-hidden">
    <div className="flex-1 min-w-0 bg-neutral-50 dark:bg-neutral-950 p-6 overflow-y-auto overflow-x-hidden">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 sm:mb-8">
          <div className="flex items-start sm:items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-neutral-800 dark:text-neutral-100">TheBotCompany</h1>
              <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-1 hidden sm:block">Multi-project AI Agent Orchestrator</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={openNotificationsPanel}
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
                onClick={openSettingsPanel}
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
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
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
                  
                  <div className="flex items-center justify-between sm:justify-end gap-3 pl-13 sm:pl-0">
                    <div className="text-left sm:text-right">
                      <StatusPill variant={project.isComplete ? (project.completionSuccess ? 'success' : 'danger') : project.paused ? 'warning' : project.sleeping ? 'info' : project.currentAgent ? 'success' : project.running ? 'success' : 'danger'}>
                        {project.isComplete ? (project.completionSuccess ? 'Complete' : 'Ended')
                          : project.paused ? (project.currentAgent ? 'Pausing...' : 'Paused')
                          : project.sleeping ? 'Sleeping' 
                          : project.currentAgent ? project.currentAgent 
                          : project.running ? 'Running' 
                          : 'Stopped'}
                      </StatusPill>
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
                      <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Epoch {project.epochCount || 0} · Cycle {project.cycleCount}{project.phase ? ` · ${project.phase}` : ''}</p>
                      {project.cost && project.cost.totalCost > 0 && (
                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">${project.cost.totalCost.toFixed(2)} · ${project.cost.last24hCost.toFixed(2)}/24h</p>
                      )}
                    </div>
                    {project.archived && (
                      <StatusPill variant="meta">Archived</StatusPill>
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

      <LoginModal
        open={loginModal}
        onClose={() => { setLoginModal(false); setLoginInput('') }}
        loginInput={loginInput}
        setLoginInput={setLoginInput}
        handleLogin={handleLogin}
      />

      <SettingsPanel
        settingsOpen={settingsOpen}
        onClose={closeSettingsPanel}
        theme={theme}
        setTheme={setTheme}
        setShowApiKeyHelp={setShowApiKeyHelp}
      />

      <NotificationPanel
        open={notifCenter}
        onClose={closeNotificationsPanel}
      />

      <ApiKeyHelpModal open={showApiKeyHelp} onClose={() => setShowApiKeyHelp(false)} />
    </div>
    <PanelSlot />
    </div>
  )
}
