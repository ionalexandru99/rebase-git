import type {
  PushBranch,
  PushDestination,
  PushRejectedReason,
  RemoteBranchUpdated,
} from "@rebase/contracts";
import { Data, type Effect } from "effect";

export class RepositoryPushError extends Data.TaggedError(
  "RepositoryPushError",
)<{
  readonly reason: PushRejectedReason | "Denied" | "Disconnected";
  readonly detail: string;
}> {}

export interface RepositoryPushClient {
  readonly push: (
    command: PushBranch,
  ) => Effect.Effect<RemoteBranchUpdated, RepositoryPushError>;
}

export interface PushUpstream {
  readonly destination: PushDestination;
  readonly ahead: number;
  readonly behind: number;
  readonly gone: boolean;
  readonly remoteOid?: string;
}

export interface PushTarget {
  readonly branch: string;
  readonly remotes: readonly string[];
  readonly upstream?: PushUpstream;
}

export interface ForcePushReview {
  readonly branch: string;
  readonly destination: PushDestination;
  readonly expectedOid: string;
  readonly removed: number;
}

export interface RepositoryPushState {
  readonly connected: boolean;
  readonly running: { readonly message: string } | null;
  readonly review: ForcePushReview | null;
  readonly notice: string | null;
}
