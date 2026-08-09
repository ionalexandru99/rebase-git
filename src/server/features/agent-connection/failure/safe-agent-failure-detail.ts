const MAX_FAILURE_DETAIL_LENGTH = 256

function boundedDetail(value: string): string {
  return value.slice(0, MAX_FAILURE_DETAIL_LENGTH)
}

function detailKind(detail: unknown): string {
  if (detail instanceof Error) {
    return 'Error'
  }
  if (typeof detail === 'object' && detail !== null && '_tag' in detail) {
    return 'TaggedError'
  }
  return typeof detail
}

export function safeAgentFailureDetail(
  detail: unknown,
  sensitiveValues: ReadonlyArray<string> = []
): { readonly kind: string; readonly message?: string } {
  if (!(detail instanceof Error) || sensitiveValues.length === 0) {
    return { kind: detailKind(detail) }
  }

  const message = sensitiveValues.reduce(
    (redactedMessage, sensitiveValue) =>
      sensitiveValue.length === 0
        ? redactedMessage
        : redactedMessage.replaceAll(sensitiveValue, '[redacted]'),
    detail.message
  )

  return {
    kind: detailKind(detail),
    message: boundedDetail(message)
  }
}
