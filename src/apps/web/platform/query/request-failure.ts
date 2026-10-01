import type { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type {
  BranchCheckedOutElsewhere,
  RefMissing,
} from "#contracts/repository-refs/repository-refs.contract.ts";

export type RequestFailure<Failure> =
  | { readonly _tag: "Rejected"; readonly failure: Failure }
  | { readonly _tag: "Unanswered" }
  | { readonly _tag: "Cancelled" };

export type TaggedFailure = { readonly _tag: string };

export type FailureMessages<Failure extends TaggedFailure> = {
  readonly [Tag in Failure["_tag"]]?: (
    failure: Extract<Failure, { readonly _tag: Tag }>,
  ) => string;
};

type SharedFailure =
  | { readonly _tag: "RepositoryMissing" }
  | RepositoryRejected
  | RefMissing
  | typeof BranchCheckedOutElsewhere.Type;

const repositoryMissing = "The repository is no longer available.";

const failureTags = new Set(["Rejected", "Unanswered", "Cancelled"]);

export function requestFailure<Failure>(
  error: unknown,
): RequestFailure<Failure> {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string" &&
    failureTags.has(error._tag)
  )
    return error as RequestFailure<Failure>;
  throw error;
}

export function rejection<Failure extends TaggedFailure>(
  failure: RequestFailure<Failure> | null | undefined,
) {
  return failure?._tag === "Rejected" ? failure.failure : undefined;
}

export function describeFailure<Failure extends TaggedFailure>(
  failure: RequestFailure<Failure>,
  messages: FailureMessages<Failure> = {},
): string {
  switch (failure._tag) {
    case "Unanswered":
      return "The server did not answer. Check the connection and try again.";
    case "Cancelled":
      return "The request was cancelled.";
    case "Rejected":
      return describeRejection(failure.failure, messages);
  }
}

function describeRejection<Failure extends TaggedFailure>(
  failure: Failure,
  messages: FailureMessages<Failure>,
) {
  const describe = messages[failure._tag as Failure["_tag"]] as
    | ((failure: Failure) => string)
    | undefined;
  return describe === undefined ? sharedWording(failure) : describe(failure);
}

function sharedWording(failure: TaggedFailure): string {
  const shared = failure as SharedFailure;
  switch (shared._tag) {
    case "RepositoryMissing":
      return repositoryMissing;
    case "RepositoryRejected":
      if (shared.reason === "Missing") return repositoryMissing;
      if (shared.reason === "Busy") return "Another Git operation is running.";
      return detailOf(shared);
    case "RefMissing":
      return `${shared.name} no longer exists.`;
    case "BranchCheckedOutElsewhere":
      return `${shared.name} is checked out in ${shared.worktreePath}.`;
    default:
      return detailOf(failure);
  }
}

function detailOf(failure: TaggedFailure) {
  return gitMessage(
    "detail" in failure && typeof failure.detail === "string"
      ? failure.detail
      : "",
  );
}

export function gitMessage(detail: string, summary?: string) {
  const lines = detail
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !line.startsWith("hint:"));
  const headline =
    summary ??
    sentence(
      lines.find((line) => /^(fatal|error):/.test(line)) ?? lines[0] ?? "",
    );
  if (headline === undefined) return "Git could not complete the operation.";
  return lines.length > 1 || (summary !== undefined && lines.length > 0)
    ? `${headline}\n\n${lines.join("\n")}`
    : headline;
}

function sentence(line: string) {
  const text = line
    .trim()
    .replace(/^(fatal|error|warning):\s*/, "")
    .replace(/:$/, "");
  if (text.length === 0) return undefined;
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}
