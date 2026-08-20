import type {
  authorizationRoles,
  operationStatuses,
} from "@rebase/server/environment-server/state/schema";
import type { EnvironmentStorageError } from "@rebase/server/environment-server/storage/storage-error";
import type { Effect } from "effect";

export type AuthorizationRole = (typeof authorizationRoles)[number];

export interface AuthorizationMetadata {
  readonly createdAt: string;
  readonly id: string;
  readonly label: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
  readonly role: AuthorizationRole;
}

export type OperationStatus = (typeof operationStatuses)[number];

export interface OperationActivity {
  readonly finishedAt: string | null;
  readonly id: string;
  readonly kind: string;
  readonly startedAt: string;
  readonly status: OperationStatus;
}

export interface EnvironmentState {
  readonly automaticPort: number | null;
  readonly databaseSettings: {
    readonly busyTimeout: number;
    readonly foreignKeys: boolean;
    readonly journalMode: string;
  };
  readonly environmentId: string;
  readonly listAuthorizations: Effect.Effect<
    readonly AuthorizationMetadata[],
    EnvironmentStorageError
  >;
  readonly listOperationActivity: Effect.Effect<
    readonly OperationActivity[],
    EnvironmentStorageError
  >;
  readonly recordOperationActivity: (
    activity: OperationActivity,
  ) => Effect.Effect<void, EnvironmentStorageError>;
  readonly saveAuthorization: (
    authorization: AuthorizationMetadata,
  ) => Effect.Effect<void, EnvironmentStorageError>;
  readonly selectAutomaticPort: (
    port: number,
  ) => Effect.Effect<void, EnvironmentStorageError>;
}
