import { Loader2Icon } from 'lucide-react'
import { createSignal, Show } from '@/lib/react-compat'
import { Button } from './ui/button'
import { Panel, PanelHeader, PanelHeaderGroup, PanelTitle } from './ui/panel'
import { Textarea } from './ui/textarea'

interface CommitPanelProps {
  onCommit: (message: string) => Promise<boolean>
  loading: boolean
}

const MAX_SUBJECT_LENGTH = 72

export function CommitPanel(props: CommitPanelProps) {
  const [message, setMessage] = createSignal('')

  const handleCommit = async () => {
    const trimmed = message().trim()
    if (!trimmed) {
      return
    }
    const success = await props.onCommit(trimmed)
    if (success) {
      setMessage('')
    }
  }

  const subjectLength = () => (message().split('\n')[0] ?? '').length
  const subjectWarn = () => subjectLength() > MAX_SUBJECT_LENGTH

  return (
    <Panel className="flex-none">
      <PanelHeader>
        <PanelHeaderGroup>
          <PanelTitle>Commit</PanelTitle>
        </PanelHeaderGroup>
        <span
          className={`text-xs tabular-nums ${
            subjectWarn() ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {subjectLength()}/{MAX_SUBJECT_LENGTH}
        </span>
      </PanelHeader>

      <div className="flex flex-col gap-2.5 p-3">
        <Textarea
          value={message()}
          onChange={(event) => setMessage(event.currentTarget.value)}
          placeholder="Summarize the change in one line, then describe details below."
          rows={3}
          className="resize-none"
        />
        <div className="flex items-center justify-end">
          <Button size="sm" onClick={handleCommit} disabled={!message().trim() || props.loading}>
            <Show when={props.loading} fallback={'Commit Changes'}>
              <Loader2Icon className="animate-spin" />
              Committing...
            </Show>
          </Button>
        </div>
      </div>
    </Panel>
  )
}
