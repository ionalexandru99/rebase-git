import { Schema } from "effect";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  RefName,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";
import type { GitHostKind } from "#contracts/source-control/source-control.contract.ts";

export const PullRequestKind = Schema.Literals(["PullRequest", "MergeRequest"]);
export type PullRequestKind = typeof PullRequestKind.Type;

const maximumNumber = 999_999_999;

export const PullRequestNumber = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: maximumNumber }),
);

export const PullRequest = Schema.Struct({
  kind: PullRequestKind,
  number: PullRequestNumber,
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

export const LinkPullRequest = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  branch: RefName,
  number: PullRequestNumber,
  linked: Schema.Boolean,
});
export type LinkPullRequest = typeof LinkPullRequest.Type;

export const PullRequestsApi = {
  list: repositoryQuery("repositories/pull-requests", {
    request: Schema.Struct({ repositoryId: RepositoryId }),
    success: Schema.NullOr(
      Schema.Struct({
        kind: PullRequestKind,
        branches: Schema.Array(BranchPullRequests).check(
          Schema.isMaxLength(10_000),
        ),
      }),
    ),
    failure: PullRequestsUnavailable,
  }),
  find: repositoryQuery("repositories/pull-requests/find", {
    request: Schema.Struct({
      repositoryId: RepositoryId,
      number: PullRequestNumber,
    }),
    success: Schema.Struct({
      kind: PullRequestKind,
      pullRequest: Schema.NullOr(PullRequest),
    }),
    failure: PullRequestsUnavailable,
  }),
  link: repositoryCommand("repositories/pull-requests/link", {
    request: LinkPullRequest,
    success: Schema.Struct({}),
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
  const path = linkPath(url);
  return path !== undefined && pullRequestLinks[kind].test(path);
}

export function pullRequestNumber(reference: string): number | undefined {
  const text = reference.trim();
  const digits = isAnyPullRequestLink(text)
    ? /(\d+)$/.exec(text)?.[1]
    : /^[#!]?(\d+)$/.exec(text)?.[1];
  const number = Number(digits);
  return Number.isInteger(number) && number >= 1 && number <= maximumNumber
    ? number
    : undefined;
}

export function isSamePullRequestLink(url: string, reference: string) {
  const link = URL.parse(reference.trim());
  const found = URL.parse(url);
  return (
    link === null ||
    (found !== null &&
      `${link.host}${link.pathname}`.toLowerCase() ===
        `${found.host}${found.pathname}`.toLowerCase())
  );
}

function isAnyPullRequestLink(url: string) {
  const path = linkPath(url);
  return (
    path !== undefined &&
    Object.values(pullRequestLinks).some((pattern) => pattern.test(path))
  );
}

function linkPath(url: string) {
  const link = URL.parse(url);
  return link?.protocol === "https:" && link.search === "" && link.hash === ""
    ? `${link.host}${link.pathname}`
    : undefined;
}
