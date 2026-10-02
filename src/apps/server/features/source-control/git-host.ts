import type { Effect } from "effect";
import type {
  BranchPullRequests,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import type { GitHostKind } from "#contracts/source-control/source-control.contract.ts";

export type GitHostTool =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "SignedOut"; readonly version: string }
  | {
      readonly _tag: "SignedIn";
      readonly version: string;
      readonly account: string;
    };

export interface TrackedBranch {
  readonly branch: string;
  readonly head: string;
  readonly remoteUrl: string;
}

export interface GitHost {
  readonly kind: GitHostKind;
  readonly serves: (remoteUrl: string) => boolean;
  readonly tool: Effect.Effect<GitHostTool>;
  readonly pullRequests: (
    remoteUrl: string,
    branches: readonly TrackedBranch[],
  ) => Effect.Effect<readonly BranchPullRequests[], PullRequestsUnavailable>;
}

export function gitHostFor(hosts: readonly GitHost[], remoteUrl: string) {
  return hosts.find((host) => host.serves(remoteUrl));
}
