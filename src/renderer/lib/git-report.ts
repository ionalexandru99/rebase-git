import { toast } from 'sonner'
import { classifyGitFailure } from './git-failure'

export function gitFailureMessage(context: string, rawMessage: string): string {
  console.error(`[git] ${context}:`, rawMessage)
  return classifyGitFailure(rawMessage).message
}

export function toastGitFailure(title: string, rawMessage: string): void {
  toast.error(title, { description: gitFailureMessage(title, rawMessage) })
}

export function gitFailureBannerText(label: string, rawMessage: string): string {
  return `${label}: ${gitFailureMessage(label, rawMessage)}`
}

const ENGINE_UNREACHABLE =
  'Rebase could not reach the Git engine — it may have restarted. Try again; the error is in the developer console.'

export function engineFailureMessage(context: string, cause: string): string {
  console.error(`[git] ${context} — the engine call itself failed:`, cause)
  return ENGINE_UNREACHABLE
}

export function toastEngineFailure(title: string, cause: string): void {
  toast.error(title, { description: engineFailureMessage(title, cause) })
}

export function engineFailureBannerText(label: string, cause: string): string {
  return `${label}: ${engineFailureMessage(label, cause)}`
}
