import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  RefName,
  RepositoryId,
  WorktreeScope,
} from "#contracts/git/git-values.contract.ts";
import type { GitHostKind } from "#contracts/source-control/source-control.contract.ts";

export const PullRequestKind = z.enum(["PullRequest", "MergeRequest"]);
export type PullRequestKind = z.infer<typeof PullRequestKind>;

const maximumNumber = 999_999_999;

export const PullRequestNumber = z.int().min(1).max(maximumNumber);

export const PullRequest = z.object({
  kind: PullRequestKind,
  number: PullRequestNumber,
  url: z
    .string()
    .regex(/^https:\/\//)
    .max(2_048),
  title: z.string().max(1_024),
  state: z.enum(["Open", "Draft", "Merged", "Closed"]),
  checks: z.enum(["Passing", "Failing", "Pending"]).exactOptional(),
});
export type PullRequest = z.infer<typeof PullRequest>;

export const BranchPullRequests = z.object({
  branch: RefName,
  pullRequests: z.array(PullRequest).max(10).readonly(),
});
export type BranchPullRequests = z.infer<typeof BranchPullRequests>;

export const PullRequestsUnavailable = z.object({
  _tag: z.literal("PullRequestsUnavailable"),
});
export type PullRequestsUnavailable = z.infer<typeof PullRequestsUnavailable>;

export const LinkPullRequest = z.object({
  ...WorktreeScope.shape,
  branch: RefName,
  number: PullRequestNumber,
  linked: z.boolean(),
});
export type LinkPullRequest = z.infer<typeof LinkPullRequest>;

export const PullRequestsApi = {
  list: repositoryQuery("repositories/pull-requests", {
    request: z.object({ repositoryId: RepositoryId }),
    success: z
      .object({
        kind: PullRequestKind,
        branches: z.array(BranchPullRequests).max(10_000).readonly(),
      })
      .nullable(),
    failure: PullRequestsUnavailable,
  }),
  find: repositoryQuery("repositories/pull-requests/find", {
    request: z.object({
      repositoryId: RepositoryId,
      number: PullRequestNumber,
    }),
    success: z.object({
      kind: PullRequestKind,
      pullRequest: PullRequest.nullable(),
    }),
    failure: PullRequestsUnavailable,
  }),
  link: repositoryCommand("repositories/pull-requests/link", {
    request: LinkPullRequest,
    success: z.object({}),
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
