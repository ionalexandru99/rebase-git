import { z } from 'zod'

export const LogStreamRequestSchema = z.object({
  repoPath: z.string(),
  skip: z.number().int().min(0).optional(),
  maxCount: z.number().int().positive().optional(),
  streamId: z.number().int().optional()
})
export type LogStreamRequest = z.infer<typeof LogStreamRequestSchema>
export type LogStreamOptions = Pick<LogStreamRequest, 'skip' | 'maxCount' | 'streamId'>
