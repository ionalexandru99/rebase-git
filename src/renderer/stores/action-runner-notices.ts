import { toast } from 'sonner'
import { toastGitFailure } from '@/lib/git-report'

export type ActionRunnerNotice =
  | { kind: 'success'; title: string }
  | { kind: 'warning'; title: string; description: string }
  | { kind: 'error'; title: string; description?: string }
  | { kind: 'git-error'; title: string; message: string }

export function showActionRunnerNotice(notice: ActionRunnerNotice | undefined): void {
  if (!notice) {
    return
  }
  if (notice.kind === 'success') {
    toast.success(notice.title)
    return
  }
  if (notice.kind === 'warning') {
    toast.warning(notice.title, { description: notice.description })
    return
  }
  if (notice.kind === 'error') {
    if (notice.description) {
      toast.error(notice.title, { description: notice.description })
    } else {
      toast.error(notice.title)
    }
    return
  }
  toastGitFailure(notice.title, notice.message)
}
