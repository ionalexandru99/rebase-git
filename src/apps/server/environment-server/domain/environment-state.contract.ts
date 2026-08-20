export const authorizationRoles = [
  "reader",
  "contributor",
  "maintainer",
  "owner",
] as const;

export type AuthorizationRole = (typeof authorizationRoles)[number];

export interface AuthorizationMetadata {
  readonly createdAt: string;
  readonly id: string;
  readonly label: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
  readonly role: AuthorizationRole;
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
