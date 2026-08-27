import type {
  CheckoutRepositoryRef,
  RepositoryCheckedOut,
  RepositoryRefs,
  RepositoryRefTarget,
} from "@rebase/contracts";
import { Data, type Effect } from "effect";
import type { RepositoryRefsClientError } from "#web/features/repository-refs/repository-refs-client.contract";

export type RepositoryRefsControllerStatus =
  | "error"
  | "idle"
  | "loading"
  | "ready";

export class RepositoryRefsUnavailable extends Data.TaggedError(
  "RepositoryRefsUnavailable",
) {}

export type RepositoryRefsControllerError =
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

export interface RepositoryRefsController {
  readonly checkout: (
    worktreePath: string,
    target: RepositoryRefTarget,
  ) => Promise<RepositoryCheckedOut>;
  readonly getSnapshot: () => RepositoryRefsSnapshot;
  readonly invalidate: () => void;
  readonly refresh: () => Promise<void>;
  readonly select: (repositoryId: string | undefined) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface RepositoryRefsGateway {
  readonly checkout: (
    credential: string,
    command: CheckoutRepositoryRef,
  ) => Effect.Effect<RepositoryCheckedOut, RepositoryRefsClientError>;
  readonly read: (
    credential: string,
    repositoryId: string,
  ) => Effect.Effect<RepositoryRefs, RepositoryRefsClientError>;
}
