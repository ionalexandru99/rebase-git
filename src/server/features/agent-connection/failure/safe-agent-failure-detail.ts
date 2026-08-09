const MAX_FAILURE_DETAIL_LENGTH = 256

function boundedDetail(value: string): string {
  return value.slice(0, MAX_FAILURE_DETAIL_LENGTH)
}

function detailKind(detail: unknown): string {
  if (typeof detail === 'object' && detail !== null && '_tag' in detail) {
    const tag = Reflect.get(detail, '_tag')
    if (typeof tag === 'string') {
      return boundedDetail(tag)
    }
  }
  if (detail instanceof Error) {
    return boundedDetail(detail.name)
  }
  return boundedDetail(typeof detail)
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
