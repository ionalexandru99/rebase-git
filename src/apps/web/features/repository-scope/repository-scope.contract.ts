import type { EnvironmentRequestClient } from "@rebase/environment-client";
import type { ManagedRuntime } from "effect";
import type { RepositoryRefsController } from "#web/features/repository-refs/index";
import type { EnvironmentChanges } from "#web/platform/environment/environment-protocol.contract";

export interface RepositoryTarget {
  readonly repositoryId: string;
  readonly worktreePath: string;
  readonly requests: EnvironmentRequestClient;
  readonly changes: EnvironmentChanges;
  readonly refs: Pick<RepositoryRefsController, "apply" | "checkout">;
  readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
}

export interface RepositoryScope {
  readonly target: RepositoryTarget;
  readonly connected: boolean;
  readonly readable: boolean;
  readonly writable: boolean;
}
