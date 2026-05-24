import { FolderOpenIcon, Loader2Icon } from 'lucide-solid'
import { Show } from 'solid-js'
import { Button } from '../ui/button'

interface WorkspacePickerProps {
  loading: boolean
  onSelectDirectory: () => void
}

export function WorkspacePicker(props: WorkspacePickerProps) {
  return (
    <div class="p-3.5">
      <div class="mb-3 flex flex-col items-center justify-center rounded-sm border border-dashed border-border px-4 py-7 text-center">
        <FolderOpenIcon class="mb-2 h-5 w-5 text-muted-foreground/50" stroke-width={1.5} />
        <p class="text-sm text-muted-foreground">No workspace folder selected</p>
      </div>
      <Button onClick={() => props.onSelectDirectory()} disabled={props.loading} class="w-full">
        <Show when={props.loading} fallback={<FolderOpenIcon />}>
          <Loader2Icon class="animate-spin" />
        </Show>
        Select Working Folder
      </Button>
    </div>
  )
}
