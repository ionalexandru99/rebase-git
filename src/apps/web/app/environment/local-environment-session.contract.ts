import type { EnvironmentAccessCapability } from "@rebase/contracts";
import type {
  EnvironmentAccessDenied,
  EnvironmentConnectionFailure,
  EnvironmentCredential,
  EnvironmentRequestClient,
} from "@rebase/environment-client";
import type { Effect, ManagedRuntime, Scope } from "effect";
import type { EnvironmentProtocolConnection } from "#web/app/environment/connection/environment-protocol-connection.contract";
import type { EnvironmentFilesystemController } from "#web/features/environment-filesystem/environment-filesystem-controller.contract";
import type { RepositoryCatalogController } from "#web/features/repository-catalog/repository-catalog-controller.contract";
import type { RepositoryHistoryGateway } from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryRefsController } from "#web/features/repository-refs/repository-refs-controller.contract";
import type { EnvironmentChanges } from "#web/platform/environment/environment-protocol.contract";
import type { ReadableStore } from "#web/platform/store/store";

export type LocalEnvironmentSessionState =
  | { readonly _tag: "PairingRequired" }
  | { readonly _tag: "Authorizing" }
  | { readonly _tag: "Connecting" }
  | {
      readonly _tag: "Connected";
      readonly environmentId: string;
      readonly accessCapabilities: readonly EnvironmentAccessCapability[];
    }
  | {
      readonly _tag: "Reconnecting";
      readonly attempt: number;
      readonly environmentId?: string;
    }
  | {
      readonly _tag: "AuthorizationFailed";
      readonly failure: EnvironmentAccessDenied;
    }
  | {
      readonly _tag: "ProtocolMismatch";
      readonly message: string;
    };

export interface ConnectedFeature {
  readonly connect: (
    connection: EnvironmentProtocolConnection,
  ) => Effect.Effect<void, never, Scope.Scope>;
  readonly invalidate?: (repositoryIds?: readonly string[]) => void;
}

export interface LocalEnvironmentControllers {
  readonly filesystem: EnvironmentFilesystemController;
  readonly repositoryCatalog: RepositoryCatalogController;
  readonly repositoryHistory: RepositoryHistoryGateway;
  readonly repositoryRefs: RepositoryRefsController;
}

export interface LocalEnvironmentSession
  extends LocalEnvironmentControllers,
    ReadableStore<LocalEnvironmentSessionState> {
  readonly changes: EnvironmentChanges;
  readonly requests: EnvironmentRequestClient;
  readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
  readonly start: () => void;
  readonly stop: () => void;
}

export interface LocalEnvironmentGateway {
  readonly connect: (
    credential: EnvironmentCredential,
    lastObservedSequence: number | undefined,
  ) => Effect.Effect<
    EnvironmentProtocolConnection,
    EnvironmentConnectionFailure,
    Scope.Scope
  >;
  readonly authorize: () => Effect.Effect<
    EnvironmentCredential,
    EnvironmentConnectionFailure
  >;
}

export interface LocalEnvironmentSessionOptions {
  readonly controllers: LocalEnvironmentControllers;
  readonly features: readonly ConnectedFeature[];
  readonly gateway: LocalEnvironmentGateway;
  readonly requests: EnvironmentRequestClient;
  readonly runtime: ManagedRuntime.ManagedRuntime<never, never>;
  readonly waitBeforeReconnect?: (attempt: number) => Effect.Effect<void>;
}
