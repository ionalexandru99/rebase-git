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
