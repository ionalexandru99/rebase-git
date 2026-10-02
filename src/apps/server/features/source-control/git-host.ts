import { Effect, Option } from "effect";
import type {
  BranchPullRequests,
  PullRequestsUnavailable,
} from "#contracts/pull-requests/pull-requests.contract.ts";
import type { GitHostKind } from "#contracts/source-control/source-control.contract.ts";

export interface GitHostAccount {
  readonly host: string;
  readonly account: string;
}

export type GitHostTool =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "SignedOut"; readonly version: string }
  | {
      readonly _tag: "SignedIn";
      readonly version: string;
      readonly accounts: readonly GitHostAccount[];
    };

export interface TrackedBranch {
  readonly branch: string;
  readonly head: string;
  readonly remoteUrl: string;
}

export interface GitHost {
  readonly kind: GitHostKind;
  readonly serves: (remoteUrl: string) => Effect.Effect<boolean>;
  readonly tool: Effect.Effect<GitHostTool>;
  readonly pullRequests: (
    remoteUrl: string,
    branches: readonly TrackedBranch[],
  ) => Effect.Effect<readonly BranchPullRequests[], PullRequestsUnavailable>;
}

export function gitHostFor(hosts: readonly GitHost[], remoteUrl: string) {
  return Effect.findFirst(hosts, (host) => host.serves(remoteUrl)).pipe(
    Effect.map(Option.getOrUndefined),
  );
}

export function hostTool(
  host: string,
  version: Effect.Effect<string | undefined>,
  account: Effect.Effect<string | undefined>,
): Effect.Effect<GitHostTool> {
  return Effect.gen(function* () {
    const installed = yield* version;
    if (installed === undefined) return { _tag: "Missing" } as const;
    const signedIn = yield* account;
    return signedIn === undefined
      ? ({ _tag: "SignedOut", version: installed } as const)
      : ({
          _tag: "SignedIn",
          version: installed,
          accounts: [{ host, account: signedIn }],
        } as const);
  });
}

export function chunks<Item>(items: readonly Item[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size),
  );
}
