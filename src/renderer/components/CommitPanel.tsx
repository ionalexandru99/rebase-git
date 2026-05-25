import { Loader2Icon } from 'lucide-solid'
import { createSignal, Show } from 'solid-js'
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
    <Panel class="flex-none">
      <PanelHeader>
        <PanelHeaderGroup>
          <PanelTitle>Commit</PanelTitle>
        </PanelHeaderGroup>
        <span
          class={`text-xs tabular-nums ${
            subjectWarn() ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {subjectLength()}/{MAX_SUBJECT_LENGTH}
        </span>
      </PanelHeader>

      <div class="flex flex-col gap-2.5 p-3">
        <Textarea
          value={message()}
          onInput={(event) => setMessage(event.currentTarget.value)}
          placeholder="Summarize the change in one line, then describe details below."
          rows={3}
          class="resize-none"
        />
        <div class="flex items-center justify-end">
          <Button size="sm" onClick={handleCommit} disabled={!message().trim() || props.loading}>
            <Show when={props.loading} fallback={'Commit Changes'}>
              <Loader2Icon class="animate-spin" />
              Committing...
            </Show>
          </Button>
        </div>
      </div>
    </Panel>
  )
}
