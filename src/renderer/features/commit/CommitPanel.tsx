import { useEffect, useRef, useState } from 'react'
import { CommitPanelView } from './CommitPanelView'

interface CommitPanelProps {
  onCommit: (message: string) => Promise<boolean>
  onAmend: (
    message: string,
    droppedHeadPaths: string[],
    droppedHeadHunks: { file: string; hunks: string[] }[],
    expectedHead: string
  ) => Promise<boolean>
  expectedHead: string | undefined
  loadHeadMessage: () => Promise<string | null>
  amendAvailable: boolean
  amendDisabled: boolean
  loading: boolean
  branch: string
  stagedCount: number
  onAmendChange?: (amend: boolean) => void
  droppedHeadPaths?: string[]
  droppedHeadHunks?: { file: string; hunks: string[] }[]
  prefillMessage?: string
  concludesMerge?: boolean
  commitBlockedReason?: string
}

export function CommitPanel(props: CommitPanelProps) {
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [savedDraft, setSavedDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const messageRef = useRef(message)
  const amendRef = useRef(amend)
  const amendLoadGeneration = useRef(0)
  const submittingRef = useRef(false)
  const appliedPrefill = useRef<string | undefined>(undefined)

  useEffect(() => {
    const prefill = props.prefillMessage
    if (prefill === appliedPrefill.current) {
      return
    }
    const userTyped =
      messageRef.current.trim().length > 0 && messageRef.current !== appliedPrefill.current
    appliedPrefill.current = prefill
    if (userTyped || amendRef.current) {
      return
    }
    messageRef.current = prefill ?? ''
    setMessage(prefill ?? '')
  }, [props.prefillMessage])

  const handleAmendToggle = async (nextAmend: boolean) => {
    if (nextAmend) {
      setSavedDraft(message)
      amendRef.current = true
      setAmend(true)
      props.onAmendChange?.(true)
      const generation = amendLoadGeneration.current + 1
      amendLoadGeneration.current = generation
      const headMessage = await props.loadHeadMessage()
      if (headMessage !== null && amendRef.current && amendLoadGeneration.current === generation) {
        messageRef.current = headMessage
        setMessage(headMessage)
      }
    } else {
      amendLoadGeneration.current += 1
      amendRef.current = false
      setAmend(false)
      props.onAmendChange?.(false)
      messageRef.current = savedDraft
      setMessage(savedDraft)
    }
  }

  const handleCommit = async () => {
    if (submittingRef.current) {
      return
    }
    const submittedMessage = messageRef.current
    const trimmed = submittedMessage.trim()
    if (!trimmed) {
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      let success: boolean
      if (amendRef.current) {
        const expectedHead = props.expectedHead
        if (!expectedHead) {
          return
        }
        success = await props.onAmend(
          trimmed,
          props.droppedHeadPaths ?? [],
          props.droppedHeadHunks ?? [],
          expectedHead
        )
      } else {
        success = await props.onCommit(trimmed)
      }
      if (success) {
        setMessage((current) => {
          if (current !== submittedMessage) {
            return current
          }
          messageRef.current = ''
          return ''
        })
        amendRef.current = false
        setAmend(false)
        props.onAmendChange?.(false)
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const loading = props.loading || submitting
  const hasDroppedFiles = amend && (props.droppedHeadPaths?.length ?? 0) > 0

  return (
    <CommitPanelView
      message={message}
      amend={amend}
      amendAvailable={props.amendAvailable}
      amendDisabled={props.amendDisabled}
      loading={loading}
      branch={props.branch}
      stagedCount={props.stagedCount}
      concludesMerge={Boolean(props.concludesMerge)}
      commitBlockedReason={props.commitBlockedReason}
      hasDroppedFiles={hasDroppedFiles}
      expectedHeadAvailable={Boolean(props.expectedHead)}
      onMessageChange={(nextMessage) => {
        amendLoadGeneration.current += 1
        messageRef.current = nextMessage
        setMessage(nextMessage)
      }}
      onAmendChange={(nextAmend) => void handleAmendToggle(nextAmend)}
      onCommit={() => void handleCommit()}
    />
  )
}
