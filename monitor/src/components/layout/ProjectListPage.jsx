import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Bell, Unlock, Lock, Settings, Plus, Folder, BellOff } from 'lucide-react'
import { PanelSlot } from '@/components/ui/panel'
import Footer from '@/components/layout/Footer'
import SleepCountdown from '@/components/layout/SleepCountdown'
import SettingsPanel from '@/components/panels/SettingsPanel'
import NotificationPanel from '@/components/panels/NotificationPanel'
import LoginModal from '@/components/modals/LoginModal'
import AddProjectModal from '@/components/modals/AddProjectModal'
import ApiKeyHelpModal from '@/components/modals/ApiKeyHelpModal'

export default function ProjectListPage({
  projects,
  selectProject,
  showArchived,
  setShowArchived,
  unreadCount,
  notifCenter,
  setNotifCenter,
  isWriteMode,
  handleLogout,
  setLoginModal,
  settingsOpen,
  setSettingsOpen,
  openAddProjectModal,
  addProjectModal,
  setAddProjectModal,
  resetAddProjectModal,
  cloneProject,
  cloneSelectedRepo,
  createNewRepo,
  fetchReposForOrg,
  finalizeAddProject,
  loginModal,
  loginInput,
  setLoginInput,
  handleLogin,
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
  notifList,
  markAllRead,
  markRead,
  expandedNotifs,
  toggleNotifExpand,
  showApiKeyHelp,
}) {
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
