import type {
  EnvironmentAccessCapability,
  EnvironmentAuthorizationRole,
} from "@rebase/contracts";

export type AuthorizationRole = EnvironmentAuthorizationRole;

export interface Environment {
  readonly automaticPort: number | null;
  readonly id: string;
}

export interface AuthorizationMetadata {
  readonly createdAt: string;
  readonly id: string;
  readonly label: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
  readonly role: AuthorizationRole;
}

export interface AuthorizationCapability {
  readonly authorizationId: string;
  readonly capability: EnvironmentAccessCapability;
}

export const operationStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_unknown",
] as const;

export const operationActivityLimit = 200;

export type OperationStatus = (typeof operationStatuses)[number];

export interface OperationActivity {
  readonly finishedAt: string | null;
  readonly id: string;
  readonly kind: string;
  readonly startedAt: string;
  readonly status: OperationStatus;
}
