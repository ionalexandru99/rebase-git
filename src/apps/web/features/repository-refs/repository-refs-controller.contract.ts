import type {
  CheckoutRepositoryRef,
  RepositoryCheckedOut,
  RepositoryRefs,
  RepositoryRefTarget,
} from "@rebase/contracts";
import { Data, type Effect } from "effect";
import type { RepositoryRefsClientError } from "#web/features/repository-refs/repository-refs-client.contract";
import type { ReadableStore } from "#web/platform/store/store";

export type RepositoryRefsControllerStatus =
  | "error"
  | "idle"
  | "loading"
  | "ready";

export class RepositoryRefsUnavailable extends Data.TaggedError(
  "RepositoryRefsUnavailable",
) {}

export class RepositoryRefsBusy extends Data.TaggedError(
  "RepositoryRefsBusy",
) {}

export type RepositoryRefsControllerError =
  | RepositoryRefsBusy
  | RepositoryRefsClientError
  | RepositoryRefsUnavailable;

export interface RepositoryRefsSnapshot {
  readonly checkingOut: boolean;
  readonly checkoutError?: RepositoryRefsControllerError;
  readonly error?: RepositoryRefsControllerError;
  readonly refs?: RepositoryRefs;
  readonly repositoryId?: string;
  readonly status: RepositoryRefsControllerStatus;
}

export interface RepositoryRefsController
  extends ReadableStore<RepositoryRefsSnapshot> {
  readonly apply: (
    repositoryId: string,
    change: (refs: RepositoryRefs) => RepositoryRefs,
  ) => void;
  readonly checkout: (
    worktreePath: string,
    target: RepositoryRefTarget,
  ) => Promise<RepositoryCheckedOut>;
  readonly invalidate: (repositoryIds?: readonly string[]) => void;
  readonly refresh: () => Promise<void>;
  readonly select: (repositoryId: string | undefined) => void;
}

export interface RepositoryRefsGateway {
  readonly checkout: (
    command: CheckoutRepositoryRef,
  ) => Effect.Effect<RepositoryCheckedOut, RepositoryRefsClientError>;
  readonly read: (
    repositoryId: string,
  ) => Effect.Effect<RepositoryRefs, RepositoryRefsClientError>;
}
