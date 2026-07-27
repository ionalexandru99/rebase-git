import { HELP_TOPIC_LABELS } from '@shared/help-links'
import { toast } from 'sonner'
import { classifyGitFailure } from './git-failure'

export function toastGitFailure(title: string, rawMessage: string): void {
  const failure = classifyGitFailure(rawMessage)
  const helpTopic = failure.helpTopic
  toast.error(title, {
    description: failure.description,
    action: helpTopic
      ? {
          label: HELP_TOPIC_LABELS[helpTopic],
          onClick: () => {
            void window.electronAPI.openHelpLink(helpTopic)
          }
        }
      : undefined
  })
}
