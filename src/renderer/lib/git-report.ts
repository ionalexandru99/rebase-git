import { toast } from 'sonner'
import { classifyGitFailure } from './git-failure'

/**
 * The single place a git failure reaches a human: the UI gets the short explanation, the developer
 * console gets git's own output. Every caller goes through here, so raw stderr can never leak into a
 * toast and detail is never lost either.
 */
export function gitFailureMessage(context: string, rawMessage: string): string {
  console.error(`[git] ${context}:`, rawMessage)
  return classifyGitFailure(rawMessage).message
}

export function toastGitFailure(title: string, rawMessage: string): void {
  toast.error(title, { description: gitFailureMessage(title, rawMessage) })
}

/** Single-line form for the tab's error banner, which has no room for a title and a body. */
export function gitFailureBannerText(label: string, rawMessage: string): string {
  return `${label}: ${gitFailureMessage(label, rawMessage)}`
}

const ENGINE_UNREACHABLE =
  'Rebase could not reach the Git engine — it may have restarted. Try again; the error is in the developer console.'

/**
 * For the calls that never reached git: a sidecar restart, a timeout, a response that failed to
 * decode. Running these through the git classifier would blame git for something it never saw, and
 * every one of them would land in the same unrecognised bucket anyway.
 */
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
