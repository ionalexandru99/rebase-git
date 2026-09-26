import { Schema } from "effect";

const maximumDetailLength = 2_048;

export const RepositoryRejected = Schema.TaggedStruct("RepositoryRejected", {
  reason: Schema.Literals(["Missing", "Busy", "Incompatible", "GitFailed"]),
  detail: Schema.String.check(Schema.isMaxLength(maximumDetailLength)),
});
export type RepositoryRejected = typeof RepositoryRejected.Type;

export function repositoryRejected(
  reason: RepositoryRejected["reason"],
  detail: string,
): RepositoryRejected {
  return {
    _tag: "RepositoryRejected",
    reason,
    detail: detail.slice(0, maximumDetailLength),
  };
}
