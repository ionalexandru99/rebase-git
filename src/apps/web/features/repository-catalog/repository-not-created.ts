import type { RepositoryNotCreated } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import {
  type RequestFailure,
  rejection,
} from "#web/platform/query/request-failure.ts";

const reasons: Record<RepositoryNotCreated["reason"], string> = {
  MalformedPath: "Choose a location inside an existing folder.",
  DestinationNotEmpty: "This folder already exists and isn't empty.",
  InsideRepository: "This folder is already inside a Git repository.",
  GitFailed: "Git couldn't finish.",
};

export function notCreatedMessage(
  failure: RequestFailure<{ readonly _tag: string }>,
) {
  const rejected = rejection(failure);
  if (rejected?._tag !== "RepositoryNotCreated") return undefined;
  const { reason, detail, leftover } = rejected as RepositoryNotCreated;
  const message =
    reason === "GitFailed" ? (detail ?? reasons[reason]) : reasons[reason];
  return leftover === undefined
    ? message
    : `${message}\nGit left a partial folder at ${leftover}.`;
}
