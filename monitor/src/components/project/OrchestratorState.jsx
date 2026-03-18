import React from 'react'
import { Activity, DollarSign, Settings, Save, Info } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import SleepCountdown from '@/components/layout/SleepCountdown'

export function OrchestratorStateCard({ selectedProject, globalUptime, controlAction, isWriteMode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="w-4 h-4" />Orchestrator State</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-neutral-600 dark:text-neutral-300">Status</span>
            <Badge variant={selectedProject.isComplete ? (selectedProject.completionSuccess ? 'success' : 'destructive') : selectedProject.paused ? 'warning' : selectedProject.running ? 'success' : 'destructive'}>
              {selectedProject.isComplete ? (selectedProject.completionSuccess ? '✅ Complete' : '🛑 Ended')
                : selectedProject.paused && selectedProject.currentAgent ? '⏳ Pausing...' : selectedProject.paused ? '⏸️ Paused' : selectedProject.running ? '▶️ Running' : '⏹️ Stopped'}
            </Badge>
          </div>
          {selectedProject.isComplete && selectedProject.completionMessage && (
            <div className={`p-3 rounded-lg text-sm ${selectedProject.completionSuccess ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'}`}>
              🏁 {selectedProject.completionMessage}
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-neutral-600 dark:text-neutral-300">Cycle</span>
            <span className="text-2xl font-mono font-bold">{selectedProject.cycleCount}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-neutral-600 dark:text-neutral-300">Agent</span>
            {selectedProject.sleeping ? (
              <Badge variant="secondary" className="flex items-center gap-1">
                💤 Sleeping
                {isWriteMode && <button onClick={(e) => { e.stopPropagation(); controlAction('skip') }} className="ml-1 hover:text-red-500 cursor-pointer" title="Skip sleep">✕</button>}
              </Badge>
            ) : (
              <Badge variant="secondary">{selectedProject.currentAgent || 'None'}</Badge>
            )}
          </div>
          {selectedProject.sleeping && selectedProject.sleepUntil && !selectedProject.paused && (
            <div className="flex justify-between items-center">
              <span className="text-neutral-600 dark:text-neutral-300">Next cycle</span>
              <SleepCountdown sleepUntil={selectedProject.sleepUntil} />
            </div>
          )}
          <Separator className="my-2" />
          <div className="flex justify-between items-center">
            <span className="text-neutral-600 dark:text-neutral-300">Phase</span>
            <Badge variant={
              selectedProject.phase === 'athena' ? 'default' :
              selectedProject.phase === 'implementation' ? 'success' :
              selectedProject.phase === 'verification' ? 'warning' : 'secondary'
            }>
              {selectedProject.phase === 'athena' ? '🧠 Planning (Athena)' :
               selectedProject.phase === 'implementation' ? (selectedProject.isFixRound ? '🔧 Fixing' : '🔨 Implementation') :
               selectedProject.phase === 'verification' ? '✅ Verification' :
               selectedProject.phase || 'Unknown'}
            </Badge>
          </div>
          {selectedProject.phase === 'implementation' && selectedProject.milestoneCyclesBudget > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-neutral-600 dark:text-neutral-300">Milestone Progress</span>
              <span className="text-sm font-mono">{selectedProject.milestoneCyclesUsed || 0} / {selectedProject.milestoneCyclesBudget} cycles</span>
            </div>
          )}
          <Separator className="my-2" />
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
  )
}

export function CostBudgetCard({ selectedProject, setBudgetInfoModal }) {
  return (
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
                <div className="p-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-xs font-medium flex items-center justify-between">
                  <span>Budget exhausted — cycle paused</span>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/projects/${selectedProject.id}/config`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ budgetPer24h: 0 }),
                        })
                        if (res.ok) window.location.reload()
                      } catch {}
                    }}
                    className="ml-2 px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded font-medium whitespace-nowrap"
                  >
                    Remove limit
                  </button>
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
  )
}

export function ConfigCard({
  configForm,
  configError,
  configDirty,
  configSaving,
  updateConfigField,
  resetConfig,
  saveConfig,
  isWriteMode,
  setIntervalInfoModal,
  setTimeoutInfoModal,
  setBudgetInfoModal,
}) {
  return (
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
              {configForm.budgetPer24h > 0 && (
                <button
                  onClick={() => updateConfigField('budgetPer24h', 0)}
                  className="mr-2 px-2 py-1.5 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
                  title="Remove budget limit"
                >
                  ✕
                </button>
              )}
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
            {isWriteMode && <button 
              onClick={saveConfig} 
              disabled={configSaving}
              className="px-3 py-1.5 rounded text-xs font-medium inline-flex items-center bg-blue-500 hover:bg-blue-600 text-white"
            >
              <Save className="w-3 h-3 mr-1.5" />{configSaving ? '...' : 'Save'}
            </button>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
