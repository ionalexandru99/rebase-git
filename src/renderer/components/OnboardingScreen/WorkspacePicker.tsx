import { FolderOpen, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface WorkspacePickerProps {
  loading: boolean
  onSelectDirectory: () => void
}

export function WorkspacePicker({ loading, onSelectDirectory }: WorkspacePickerProps) {
  return (
    <div className="p-3.5">
      <div className="mb-3 flex flex-col items-center justify-center rounded-sm border border-dashed border-border px-4 py-7 text-center">
        <FolderOpen className="mb-2 h-5 w-5 text-muted-foreground/50" strokeWidth={1.5} />
        <p className="text-sm text-muted-foreground">No workspace folder selected</p>
      </div>
      <Button onClick={onSelectDirectory} disabled={loading} className="w-full">
        {loading ? <Loader2 className="animate-spin" /> : <FolderOpen />}
        Select Working Folder
      </Button>
    </div>
  )
}
