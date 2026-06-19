import { FolderOpenIcon, Loader2Icon } from 'lucide-react'
import { Button } from '../ui/button'

interface WorkspacePickerProps {
  loading: boolean
  onSelectDirectory: () => void
}

export function WorkspacePicker(props: WorkspacePickerProps) {
  return (
    <div className="p-3.5">
      <div className="mb-3 flex flex-col items-center justify-center rounded-sm border border-dashed border-border px-4 py-7 text-center">
        <FolderOpenIcon className="mb-2 h-5 w-5 text-muted-foreground/50" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">No workspace folder selected</p>
      </div>
      <Button onClick={() => props.onSelectDirectory()} disabled={props.loading} className="w-full">
        {props.loading ? <Loader2Icon className="animate-spin" /> : <FolderOpenIcon />}
        Select Working Folder
      </Button>
    </div>
  )
}
