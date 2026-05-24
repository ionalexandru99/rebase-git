import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Panel, PanelHeader, PanelHeaderGroup, PanelTitle } from '@/components/ui/panel'
import { Textarea } from '@/components/ui/textarea'

interface CommitPanelProps {
  onCommit: (message: string) => Promise<boolean>
  loading: boolean
}

const MAX_SUBJECT_LENGTH = 72

export function CommitPanel({ onCommit, loading }: CommitPanelProps) {
  const [message, setMessage] = useState('')

  const handleCommit = async () => {
    const trimmed = message.trim()
    if (!trimmed) return
    const success = await onCommit(trimmed)
    if (success) setMessage('')
  }

  const subjectLength = (message.split('\n')[0] ?? '').length
  const subjectWarn = subjectLength > MAX_SUBJECT_LENGTH

  return (
    <Panel className="flex-none">
      <PanelHeader>
        <PanelHeaderGroup>
          <PanelTitle>Commit</PanelTitle>
        </PanelHeaderGroup>
        <span
          className={`text-xs tabular-nums ${
            subjectWarn ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {subjectLength}/{MAX_SUBJECT_LENGTH}
        </span>
      </PanelHeader>

      <div className="flex flex-col gap-2.5 p-3">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Summarize the change in one line, then describe details below."
          rows={3}
          className="resize-none"
        />
        <div className="flex items-center justify-end">
          <Button size="sm" onClick={handleCommit} disabled={!message.trim() || loading}>
            {loading ? (
              <>
                <Loader2 className="animate-spin" />
                Committing...
              </>
            ) : (
              'Commit Changes'
            )}
          </Button>
        </div>
      </div>
    </Panel>
  )
}
