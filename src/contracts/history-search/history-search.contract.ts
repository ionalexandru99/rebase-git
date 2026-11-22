import { z } from "zod";
import { streamRoute } from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  ObjectId,
  RepositoryPath,
  WorktreeScope,
} from "#contracts/git/git-values.contract.ts";

export const maximumCodeMatches = 1_000;

export const SearchCode = z.object({
  ...WorktreeScope.shape,
  text: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[^\n\r\0]+$/),
  path: RepositoryPath.exactOptional(),
  roots: z.array(ObjectId).min(1).max(40_512).readonly(),
});
export type SearchCode = z.infer<typeof SearchCode>;

export const CodeMatch = z.object({
  oid: ObjectId,
  paths: z.array(RepositoryPath).max(10_000).readonly(),
});
export type CodeMatch = z.infer<typeof CodeMatch>;

export const CodeSearchUpdate = z.discriminatedUnion("_tag", [
  z.object({
    _tag: z.literal("CodeMatches"),
    matches: z.array(CodeMatch).max(256).readonly(),
  }),
  z.object({
    _tag: z.literal("CodeSearchProgress"),
    percent: z.int().min(0).max(100),
  }),
]);
export type CodeSearchUpdate = z.infer<typeof CodeSearchUpdate>;

export const HistorySearchApi = {
  code: streamRoute("repositories/history/code-search", {
    request: SearchCode,
    success: CodeSearchUpdate,
    failure: RepositoryRejected,
  }),
};
