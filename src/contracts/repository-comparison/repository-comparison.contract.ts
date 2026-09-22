import { Schema } from "effect";

const Path = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
);
const Revision = Schema.String.check(Schema.isMaxLength(128));

export const ChangeDiff = Schema.Struct({
  path: Path,
  revision: Revision,
  kind: Schema.Literals([
    "text",
    "image",
    "binary",
    "large",
    "conflict",
    "submodule",
    "symlink",
  ]),
  before: Schema.NullOr(Schema.String),
  after: Schema.NullOr(Schema.String),
  beforeBytes: Schema.Natural,
  afterBytes: Schema.Natural,
  mime: Schema.NullOr(Schema.String),
  patch: Schema.String,
});
export type ChangeDiff = typeof ChangeDiff.Type;
