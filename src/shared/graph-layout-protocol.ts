import { z } from 'zod'

export const LayoutCommitWireSchema = z.object({
  hash: z.string(),
  parents: z.array(z.string())
})
export type LayoutCommitWire = z.infer<typeof LayoutCommitWireSchema>

export const LayoutRowWireSchema = z.object({
  commitLane: z.number(),
  incoming: z.array(z.string().nullable()),
  outgoing: z.array(z.string().nullable())
})
export type LayoutRowWire = z.infer<typeof LayoutRowWireSchema>

export const LayoutSnapshotWireSchema = z.object({
  rows: z.array(LayoutRowWireSchema),
  maxLanes: z.number(),
  lanesAfter: z.array(z.string().nullable()),
  laidOutThroughIndex: z.number()
})
export type LayoutSnapshotWire = z.infer<typeof LayoutSnapshotWireSchema>

export const LayoutRequestSchema = z.object({
  type: z.literal('layout'),
  generation: z.number(),
  commits: z.array(LayoutCommitWireSchema),
  maxCommits: z.number(),
  windowEnd: z.number(),
  prev: LayoutSnapshotWireSchema.optional()
})
export type LayoutRequest = z.infer<typeof LayoutRequestSchema>

export const ExtendLayoutRequestSchema = z.object({
  type: z.literal('extend'),
  generation: z.number(),
  targetIndex: z.number(),
  commits: z.array(LayoutCommitWireSchema),
  maxCommits: z.number(),
  prev: LayoutSnapshotWireSchema
})
export type ExtendLayoutRequest = z.infer<typeof ExtendLayoutRequestSchema>

export const CancelLayoutRequestSchema = z.object({
  type: z.literal('cancel'),
  generation: z.number()
})
export type CancelLayoutRequest = z.infer<typeof CancelLayoutRequestSchema>

export const LayoutWorkerRequestSchema = z.discriminatedUnion('type', [
  LayoutRequestSchema,
  ExtendLayoutRequestSchema,
  CancelLayoutRequestSchema
])
export type LayoutWorkerRequest = z.infer<typeof LayoutWorkerRequestSchema>

export const LayoutResultMessageSchema = z.object({
  type: z.literal('layout-result'),
  generation: z.number(),
  rows: z.array(LayoutRowWireSchema),
  maxLanes: z.number(),
  lanesAfter: z.array(z.string().nullable()),
  fromIndex: z.number(),
  toIndex: z.number()
})
export type LayoutResultMessage = z.infer<typeof LayoutResultMessageSchema>

export function toLayoutCommitWire(
  commits: ReadonlyArray<{ hash: string; parents: string[] }>
): LayoutCommitWire[] {
  return commits.map((commit) => ({ hash: commit.hash, parents: commit.parents }))
}
