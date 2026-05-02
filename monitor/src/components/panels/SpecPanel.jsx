import React, { useEffect, useState } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import { Panel, PanelHeader, PanelContent } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'

export default function SpecPanel({ open, onClose, projectApi, authFetch, showToast }) {
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const dirty = content !== original

  const loadSpec = async () => {
    if (!projectApi) return
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(projectApi('/spec'))
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load spec')
      setContent(data.content || '')
      setOriginal(data.content || '')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) loadSpec()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectApi])

  const saveSpec = async () => {
    if (!projectApi) return
    setSaving(true)
    setError(null)
    try {
      const res = await authFetch(projectApi('/spec'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save spec')
      setOriginal(content)
      showToast?.('Spec saved')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel id="spec" open={open} onClose={onClose}>
      <PanelHeader onClose={onClose}>
        <span className="inline-flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Project Spec
        </span>
      </PanelHeader>
      <PanelContent>
        <div className="space-y-3">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Human-owned project specification. Agents can read this file, but cannot edit it.
          </p>

          {error && (
            <div className="p-3 rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <textarea
            className="w-full min-h-[55vh] p-3 text-sm font-mono border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
            value={content}
            onChange={e => setContent(e.target.value)}
            disabled={loading || saving}
            placeholder="Write the human-owned project spec here..."
          />

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              {loading ? 'Loading…' : dirty ? 'Unsaved changes' : 'Saved'}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={loadSpec} disabled={loading || saving}>
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Reload
              </Button>
              <Button onClick={saveSpec} disabled={loading || saving || !dirty}>
                {saving ? 'Saving…' : 'Save Spec'}
              </Button>
            </div>
          </div>
        </div>
      </PanelContent>
    </Panel>
  )
}
