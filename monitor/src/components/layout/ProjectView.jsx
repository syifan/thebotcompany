import React from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Users, Sparkles, Settings, ScrollText, RefreshCw, Pause, Play, RotateCcw, Save, GitPullRequest, Clock, User, UserCheck, ArrowLeft, Github, Bell, BellOff, ChevronDown, Lock, Unlock } from 'lucide-react'
import { Modal, ModalHeader, ModalContent } from '@/components/ui/modal'
import { Panel, PanelSlot, PanelHeader, PanelContent } from '@/components/ui/panel'
import ReactMarkdown from 'react-markdown'
import ScheduleDiagram, { parseScheduleBlock, stripAllMetaBlocks, MetaBlockBadges } from '@/components/ScheduleDiagram'
import remarkGfm from 'remark-gfm'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

import Footer from '@/components/layout/Footer'
import { OrchestratorStateCard, CostBudgetCard, ConfigCard } from '@/components/project/OrchestratorState'
import WorkerCard from '@/components/project/WorkerCard'
import IssuesSidebar from '@/components/project/IssuesSidebar'
import AgentReportsCard from '@/components/project/AgentReportsCard'
import SettingsPanel from '@/components/panels/SettingsPanel'
import NotificationPanel from '@/components/panels/NotificationPanel'
import BootstrapPanel from '@/components/panels/BootstrapPanel'
import ReportsPanel from '@/components/panels/ReportsPanel'
import LoginModal from '@/components/modals/LoginModal'
import ApiKeyHelpModal from '@/components/modals/ApiKeyHelpModal'

export default function ProjectView({
  selectedProject,
  goToProjectList,
  projects,
  selectProject,
  error,
  projectLoading,
  globalUptime,
  isWriteMode,
  handleLogout,
  setLoginModal,
  controlAction,
  openBootstrapModal,
  notifCenter,
  setNotifCenter,
  unreadCount,
  repoUrl,
  projectApi,
  configForm,
  configError,
  configDirty,
  configSaving,
  updateConfigField,
  resetConfig,
  saveConfig,
  setIntervalInfoModal,
  setTimeoutInfoModal,
  setBudgetInfoModal,
  intervalInfoModal,
  timeoutInfoModal,
  budgetInfoModal,
  agents,
  prs,
  comments,
  commentsLoading,
  loadMoreComments,
  liveAgentLog,
  setFocusedReportId,
  setReportsPanelOpen,
  issues,
  issueFilter,
  setIssueFilter,
  openIssueModal,
  setCreateIssueModal,
  logs,
  logsRef,
  logsAutoFollow,
  setLogsAutoFollow,
  agentModal,
  setAgentModal,
  agentSettingsModal,
  setAgentSettingsModal,
  saveAgentSettings,
  availableModels,
  bootstrapModal,
  setBootstrapModal,
  executeBootstrap,
  issueModal,
  setIssueModal,
  submitIssueComment,
  reportsPanelOpen,
  focusedReportId,
  selectedAgent,
  clearAgentFilter,
  openAgentModal,
  openAgentSettings,
  createIssueModal,
  createIssue,
  selectAgent,
  modKey,
  notifList,
  markAllRead,
  markRead,
  expandedNotifs,
  toggleNotifExpand,
  loginModal,
  loginInput,
  setLoginInput,
  handleLogin,
  projectSettingsOpen,
  setProjectSettingsOpen,
  settingsOpen,
  setSettingsOpen,
  theme,
  setTheme,
  notificationsEnabled,
  toggleNotifications,
  detailedNotifs,
  setDetailedNotifs,
  setShowApiKeyHelp,
  globalTokenInput,
  setGlobalTokenInput,
  tokenSaving,
  setTokenSaving,
  setHasGlobalToken,
  setGlobalTokenType,
  setProviderTokens,
  setGlobalTokenPreview,
  setToast,
  providerTokens,
  codexLoginState,
  setCodexLoginState,
  authFetch,
  projectSettingsModal,
  showApiKeyHelp,
  toast,
}) {
  if (!selectedProject) return null

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
