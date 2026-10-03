import { Schema } from "effect";
import { repositoryQuery } from "#contracts/environment-connection/environment-route.contract.ts";
import { RefName, RepositoryId } from "#contracts/git/git-values.contract.ts";
import type { GitHostKind } from "#contracts/source-control/source-control.contract.ts";

export const PullRequest = Schema.Struct({
  kind: Schema.Literals(["PullRequest", "MergeRequest"]),
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  url: Schema.String.check(
    Schema.isPattern(/^https:\/\//),
    Schema.isMaxLength(2_048),
  ),
  title: Schema.String.check(Schema.isMaxLength(1_024)),
  state: Schema.Literals(["Open", "Draft", "Merged", "Closed"]),
  checks: Schema.optionalKey(
    Schema.Literals(["Passing", "Failing", "Pending"]),
  ),
});
export type PullRequest = typeof PullRequest.Type;

export const BranchPullRequests = Schema.Struct({
  branch: RefName,
  pullRequests: Schema.Array(PullRequest).check(Schema.isMaxLength(10)),
});
export type BranchPullRequests = typeof BranchPullRequests.Type;

export const PullRequestsUnavailable = Schema.TaggedStruct(
  "PullRequestsUnavailable",
  {},
);
export type PullRequestsUnavailable = typeof PullRequestsUnavailable.Type;

export const PullRequestsApi = {
  list: repositoryQuery("repositories/pull-requests", {
    request: Schema.Struct({ repositoryId: RepositoryId }),
    success: Schema.Array(BranchPullRequests).check(Schema.isMaxLength(10_000)),
    failure: PullRequestsUnavailable,
  }),
};

const pullRequestLinks: Record<GitHostKind, RegExp> = {
  github: /^github\.com\/[^/]+\/[^/]+\/pull\/\d+$/,
  gitlab: /^[^/]+\/.+\/-\/merge_requests\/\d+$/,
  "azure-devops":
    /^dev\.azure\.com\/[^/]+\/[^/]+\/_git\/[^/]+\/pullrequest\/\d+$/,
  bitbucket: /^bitbucket\.org\/[^/]+\/[^/]+\/pull-requests\/\d+$/,
  forgejo: /^[^/]+\/.+\/pulls\/\d+$/,
};

export function isPullRequestLink(url: string, kind: GitHostKind) {
  const link = URL.parse(url);
  return (
    link?.protocol === "https:" &&
    link.search === "" &&
    link.hash === "" &&
    pullRequestLinks[kind].test(`${link.host}${link.pathname}`)
  );
}
