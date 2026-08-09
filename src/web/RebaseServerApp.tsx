import { useEffect, useState } from 'react'
import type { ClientBootstrap, RebaseClient } from './features/server-connection'

type ServerState =
  | { readonly status: 'loading' }
  | { readonly status: 'connected'; readonly bootstrap: ClientBootstrap }
  | { readonly status: 'failed'; readonly message: string }

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The Server did not return a usable response.'
}

export function RebaseServerApp(props: { readonly client: RebaseClient }): React.JSX.Element {
  const [state, setState] = useState<ServerState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    props.client.loadBootstrap(controller.signal).then(
      (bootstrap) => setState({ status: 'connected', bootstrap }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: 'failed', message: failureMessage(error) })
        }
      }
    )
    return () => controller.abort()
  }, [props.client])

  if (state.status === 'loading') {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <p className="text-sm text-muted-foreground">Connecting to Rebase Server…</p>
      </main>
    )
  }

  if (state.status === 'failed') {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <section className="max-w-md space-y-3 text-center">
          <h1 className="text-xl font-semibold">Cannot connect to Rebase Server</h1>
          <p className="text-sm text-muted-foreground">{state.message}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <section className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold">Rebase Server ready</h1>
        <p className="break-all text-sm text-muted-foreground">
          {state.bootstrap.environment.path}
        </p>
        <p className="text-xs text-muted-foreground">
          {state.bootstrap.readOnly ? 'Read-only' : 'Read and write'}
        </p>
      </section>
    </main>
  )
}
