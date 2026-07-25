import type { CommitDetail, CommitIdentity } from '@shared/schemas/git'
import { initials } from '@/lib/format'

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? value : TIMESTAMP_FORMATTER.format(parsed)
}

const sameIdentity = (left: CommitIdentity, right: CommitIdentity): boolean =>
  left.name === right.name && left.email === right.email

interface CommitMetaProps {
  detail: CommitDetail
  fileCount: number
  additions: number
  deletions: number
}

export function CommitMeta(props: CommitMetaProps) {
  const detail = props.detail
  // A committer that differs from the author is the tell for a rebased, amended or applied patch,
  // so it only earns a line when it actually differs.
  const showCommitter = !sameIdentity(detail.author, detail.committer)

  return (
    <div className="shrink-0 border-b px-3 py-2" data-testid="commit-meta">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground/80">
            {initials(detail.author.name)}
          </span>
          <span className="truncate text-foreground">{detail.author.name}</span>
          <span className="truncate">{`<${detail.author.email}>`}</span>
        </span>
        <span>authored {formatTimestamp(detail.authorDate)}</span>
        {showCommitter ? (
          <span className="truncate">
            <span className="text-foreground">{detail.committer.name}</span>
            {` <${detail.committer.email}> committed ${formatTimestamp(detail.commitDate)}`}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5 tabular-nums">
          <span>
            {props.fileCount} file{props.fileCount === 1 ? '' : 's'}
          </span>
          <span className="text-add">+{props.additions}</span>
          <span className="text-del">−{props.deletions}</span>
        </span>
        {detail.parents.length > 0 ? (
          <span className="flex items-center gap-1.5">
            <span>{detail.parents.length === 1 ? 'Parent' : 'Parents'}</span>
            {detail.parents.map((parent) => (
              <span key={parent} className="font-mono text-xs text-foreground/80" title={parent}>
                {parent.slice(0, 7)}
              </span>
            ))}
          </span>
        ) : (
          <span>Root commit</span>
        )}
        {detail.parents.length > 1 ? (
          <span className="text-orange">merge · changes shown against the first parent</span>
        ) : null}
      </div>
      {detail.body ? (
        <p className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted-foreground">
          {detail.body}
        </p>
      ) : null}
    </div>
  )
}
