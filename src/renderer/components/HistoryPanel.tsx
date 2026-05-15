import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import type { GitLog } from '../types'

interface HistoryPanelProps {
  log: GitLog | null
  loading: boolean
}

export function HistoryPanel({ log, loading }: HistoryPanelProps) {
  return (
    <div className="flex flex-col bg-card rounded-lg p-4 overflow-hidden border border-border">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-card-foreground">Commit History</h2>
        {loading && <span className="text-xs text-muted-foreground">Loading...</span>}
      </div>
      <ScrollArea className="flex-1">
        <div className="pr-2">
          {!log || log.all.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commits yet</p>
          ) : (
            <ul className="space-y-2">
              {log.all.map((commit, index) => (
                <li key={commit.hash}>
                  {index > 0 && <Separator className="my-2 bg-border/50" />}
                  <div className="p-3 bg-background rounded-md border-l-2 border-primary">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {commit.hash.slice(0, 7)}
                      </Badge>
                    </div>
                    <div className="text-sm text-foreground mb-1.5 leading-snug">
                      {commit.message}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{commit.author_name}</span>
                      <span>{new Date(commit.date).toLocaleString()}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
