import { Component, type ErrorInfo, type ReactNode } from 'react'
import { type CrashScope, CrashScreen } from './CrashScreen'
import { queryClient } from './QueryProvider'

const MAC_WINDOW_CHROME = readsAsMac()

function readsAsMac(): boolean {
  try {
    return window.electronAPI.platform === 'darwin'
  } catch {
    return false
  }
}

interface ErrorBoundaryProps {
  scope: CrashScope
  onReset?: () => void
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

function crashDetails(error: Error, componentStack: string | null): string {
  const trace = error.stack ?? `${error.name}: ${error.message}`
  if (!componentStack) {
    return trace
  }
  return `${trace}\ncomponent stack:${componentStack}`
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Pick<ErrorBoundaryState, 'error'> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? null
    console.error('[app] render error', error)
    this.setState({ componentStack })
    try {
      window.electronAPI
        .reportRendererError({
          message: error.message || String(error),
          stack: error.stack,
          componentStack: componentStack ?? undefined
        })
        .catch((reportError: unknown) => {
          console.error('[app] failed to report the render error', reportError)
        })
    } catch (reportError) {
      console.error('[app] failed to report the render error', reportError)
    }
  }

  private retry = (): void => {
    if (this.props.onReset) {
      this.props.onReset()
    } else {
      queryClient.clear()
    }
    this.setState({ error: null, componentStack: null })
  }

  private reload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) {
      return this.props.children
    }

    const crashScreen = (
      <CrashScreen
        scope={this.props.scope}
        details={crashDetails(error, componentStack)}
        onRetry={this.retry}
        onReload={this.reload}
      />
    )

    if (this.props.scope === 'tab') {
      return crashScreen
    }

    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        {MAC_WINDOW_CHROME ? <header className="drag-region h-[34px] shrink-0 bg-chrome" /> : null}
        {crashScreen}
      </div>
    )
  }
}
