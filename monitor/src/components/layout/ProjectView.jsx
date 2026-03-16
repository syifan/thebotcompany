import React from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Users, Sparkles, Settings, ScrollText, RefreshCw, Pause, Play, RotateCcw, Save, GitPullRequest, ArrowLeft, Github, Bell, ChevronDown, Lock, Unlock } from 'lucide-react'
import { PanelSlot } from '@/components/ui/panel'

import Footer from '@/components/layout/Footer'
import { OrchestratorStateCard, CostBudgetCard, ConfigCard } from '@/components/project/OrchestratorState'
import WorkerCard from '@/components/project/WorkerCard'
import IssuesSidebar from '@/components/project/IssuesSidebar'
import AgentReportsCard from '@/components/project/AgentReportsCard'
import SettingsPanel from '@/components/panels/SettingsPanel'
import NotificationPanel from '@/components/panels/NotificationPanel'
import BootstrapPanel from '@/components/panels/BootstrapPanel'
import ReportsPanel from '@/components/panels/ReportsPanel'
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
  setProjSetting,
  notifUseGlobal,
  projNotifSettings,
  hasProjectToken,
  projectTokenPreview,
  projectTokenProviderLabel,
  projectTokenSaving,
  setProjectTokenSaving,
  setHasProjectToken,
  setProjectTokenPreview,
  setProjectTokenProviderLabel,
  projectTokenInput,
  setProjectTokenInput,
  projectTokenProvider,
  setProjectTokenProvider,
  projectCodexLoginState,
  setProjectCodexLoginState,
  config,
  setSelectedProject,
  fetchProjectData,
  fetchGlobalStatus,
  removeProject,
  hasGlobalToken,
  globalTokenPreview,
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

      {/* Agent Details Panel */}
      <AgentDetailPanel agentModal={agentModal} setAgentModal={setAgentModal} />

      {/* Agent Settings Modal */}
      <AgentSettingsModal agentSettingsModal={agentSettingsModal} setAgentSettingsModal={setAgentSettingsModal} saveAgentSettings={saveAgentSettings} />

      {/* Bootstrap Panel */}
      <BootstrapPanel
        bootstrapModal={bootstrapModal}
        setBootstrapModal={setBootstrapModal}
        executeBootstrap={executeBootstrap}
      />

      {/* Budget Info Modal */}
      <BudgetInfoModal open={budgetInfoModal} onClose={() => setBudgetInfoModal(false)} />

      {/* Interval Info Modal */}
      <IntervalInfoModal open={intervalInfoModal} onClose={() => setIntervalInfoModal(false)} />

      {/* Timeout Info Modal */}
      <TimeoutInfoModal open={timeoutInfoModal} onClose={() => setTimeoutInfoModal(false)} />

      {/* API Key Help Modal */}
      <ApiKeyHelpModal open={showApiKeyHelp} onClose={() => setShowApiKeyHelp(false)} />

      {/* Create Issue Modal */}
      <CreateIssueModal createIssueModal={createIssueModal} setCreateIssueModal={setCreateIssueModal} createIssue={createIssue} agents={agents} modKey={modKey} />

      {/* Issue Detail Panel */}
      <IssueDetailPanel
        issueModal={issueModal}
        setIssueModal={setIssueModal}
        isWriteMode={isWriteMode}
        authFetch={authFetch}
        projectApi={projectApi}
        submitIssueComment={submitIssueComment}
        modKey={modKey}
      />

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
      {/* Project Settings Panel */}
      <ProjectSettingsPanel
        selectedProject={selectedProject}
        projectSettingsOpen={projectSettingsOpen}
        setProjectSettingsOpen={setProjectSettingsOpen}
        setProjSetting={setProjSetting}
        notifUseGlobal={notifUseGlobal}
        projNotifSettings={projNotifSettings}
        setShowApiKeyHelp={setShowApiKeyHelp}
        hasProjectToken={hasProjectToken}
        projectTokenPreview={projectTokenPreview}
        projectTokenProviderLabel={projectTokenProviderLabel}
        projectTokenSaving={projectTokenSaving}
        setProjectTokenSaving={setProjectTokenSaving}
        authFetch={authFetch}
        projectApi={projectApi}
        setHasProjectToken={setHasProjectToken}
        setProjectTokenPreview={setProjectTokenPreview}
        setProjectTokenProviderLabel={setProjectTokenProviderLabel}
        setToast={setToast}
        projectTokenInput={projectTokenInput}
        setProjectTokenInput={setProjectTokenInput}
        projectTokenProvider={projectTokenProvider}
        setProjectTokenProvider={setProjectTokenProvider}
        projectCodexLoginState={projectCodexLoginState}
        setProjectCodexLoginState={setProjectCodexLoginState}
        codexLoginState={codexLoginState}
        isWriteMode={isWriteMode}
        config={config}
        setSelectedProject={setSelectedProject}
        fetchProjectData={fetchProjectData}
        fetchGlobalStatus={fetchGlobalStatus}
        removeProject={removeProject}
        hasGlobalToken={hasGlobalToken}
        globalTokenPreview={globalTokenPreview}
      />
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
