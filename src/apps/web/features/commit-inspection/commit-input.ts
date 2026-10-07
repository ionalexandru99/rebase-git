import { isObjectId } from "#contracts/git/git-values.contract.ts";

export interface CodeMatchTarget {
  readonly text: string;
  readonly paths: readonly string[];
}

export type CommitInput =
  | string
  | { readonly oid: string; readonly match: CodeMatchTarget };

export function isCommitInput(input: unknown): input is CommitInput {
  return (
    isObjectId(input) ||
    (typeof input === "object" &&
      input !== null &&
      "oid" in input &&
      isObjectId(input.oid) &&
      "match" in input &&
      isCodeMatchTarget(input.match))
  );
}

export function commitInputOid(input: unknown) {
  if (!isCommitInput(input)) return undefined;
  return typeof input === "string" ? input : input.oid;
}

function isCodeMatchTarget(match: unknown): match is CodeMatchTarget {
  return (
    typeof match === "object" &&
    match !== null &&
    "text" in match &&
    typeof match.text === "string" &&
    "paths" in match &&
    Array.isArray(match.paths) &&
    match.paths.every((path) => typeof path === "string")
  );
}
