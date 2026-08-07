import { Check, Copy, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'

export type CrashScope = 'app' | 'tab'

const COPY_FEEDBACK_MS = 2000

const WORDING: Record<CrashScope, { title: string; body: string }> = {
  app: {
    title: 'Rebase could not draw this window',
    body: 'Something went wrong while rendering the interface. Nothing was written to your repositories — your commits, branches, and staged changes are exactly as you left them. A commit message you were still typing may be lost.'
  },
  tab: {
    title: 'This repository could not be displayed',
    body: 'Something went wrong while rendering this tab. Your other tabs are unaffected, and nothing was written to this repository — your commits, branches, and staged changes are exactly as you left them. A commit message you were still typing may be lost.'
  }
}

interface CrashScreenProps {
  scope: CrashScope
  details: string
  onRetry: () => void
  onReload: () => void
}

export function CrashScreen(props: CrashScreenProps) {
  const [copied, setCopied] = useState(false)
  const wording = WORDING[props.scope]

  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [copied])

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(props.details)
      setCopied(true)
    } catch (error) {
      console.error('[app] failed to copy the crash details', error)
    }
  }

  return (
    <div
      role="alert"
      data-testid="crash-screen"
      data-scope={props.scope}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-background p-10 text-foreground"
    >
      <div className="inline-flex size-10 items-center justify-center rounded-full border text-muted-foreground/70">
        <TriangleAlert className="size-5" strokeWidth={1.6} />
      </div>

      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <p className="text-base font-semibold">{wording.title}</p>
        <p className="text-sm leading-relaxed text-muted-foreground">{wording.body}</p>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={props.onRetry}>
          <RotateCcw />
          Try again
        </Button>
        <Button variant="outline" onClick={props.onReload}>
          <RefreshCw />
          Restart the window
        </Button>
        <Button variant="ghost" onClick={copyDetails}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy details'}
        </Button>
      </div>
    </div>
  )
}
