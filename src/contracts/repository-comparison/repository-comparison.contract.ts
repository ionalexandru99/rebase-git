import { Schema } from "effect";
import {
  ObjectId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

const Revision = Schema.String.check(Schema.isMaxLength(128));

export const ChangeDiff = Schema.Struct({
  path: RepositoryPath,
  revision: Revision,
  kind: Schema.Literals([
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
  before: Schema.NullOr(Schema.String),
  after: Schema.NullOr(Schema.String),
  beforeBytes: Schema.Natural,
  afterBytes: Schema.Natural,
  mime: Schema.NullOr(Schema.String),
  patch: Schema.String,
  largeFileCommits: Schema.optional(
    Schema.Array(ObjectId).check(Schema.isMaxLength(2)),
  ),
});
export type ChangeDiff = typeof ChangeDiff.Type;
