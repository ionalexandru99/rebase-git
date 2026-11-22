import { z } from "zod";
import {
  ObjectId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

const Revision = z.string().max(128);

export const ChangeDiff = z.object({
  path: RepositoryPath,
  revision: Revision,
  kind: z.enum([
    "text",
    "partial",
    "image",
    "binary",
    "large",
    "conflict",
    "submodule",
    "symlink",
    "missing",
  ]),
  before: z.string().nullable(),
  after: z.string().nullable(),
  beforeBytes: z.int().nonnegative(),
  afterBytes: z.int().nonnegative(),
  mime: z.string().nullable(),
  patch: z.string(),
  largeFileCommits: z.array(ObjectId).max(2).readonly().optional(),
});
export type ChangeDiff = z.infer<typeof ChangeDiff>;
