import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
    <section className="flex flex-col overflow-hidden rounded-md border border-border bg-card">
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="text-[12px] font-semibold text-foreground">Commit</h2>
        <span
          className={`font-mono text-[10.5px] tabular-nums ${
            subjectWarn ? 'text-primary' : 'text-muted-foreground/60'
          }`}
        >
          {subjectLength}/{MAX_SUBJECT_LENGTH}
        </span>
      </header>

      <div className="flex flex-col gap-2.5 p-3">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Summarize the change in one line, then describe details below."
          rows={3}
          className="min-h-[68px] resize-none rounded-[5px] border border-border bg-background px-2.5 py-2 font-mono text-[12px] leading-relaxed text-foreground/90 shadow-none placeholder:text-muted-foreground/50 focus-visible:border-primary/40 focus-visible:ring-0"
        />
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={!message.trim() || loading}
            className="h-7 gap-1.5 rounded-[5px] bg-primary px-3 text-[11.5px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            {loading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Committing...
              </>
            ) : (
              'Commit Changes'
            )}
          </Button>
        </div>
      </div>
    </section>
  )
}
