import type { z } from 'zod'

/** Validate an IPC/HTTP payload against a Zod schema; throws on mismatch. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) {
    return result.data
  }
  throw new Error(`IPC payload failed schema validation: ${result.error.message}`)
}
