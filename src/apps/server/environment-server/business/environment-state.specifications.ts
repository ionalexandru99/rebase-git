import type { OperationStatus } from "@rebase/server/environment-server/domain/environment-state.contract";
import { type AnyColumn, eq, isNull } from "drizzle-orm";

interface EnvironmentColumns {
  readonly automaticPort: AnyColumn<{ data: number }>;
  readonly singleton: AnyColumn<{ data: number }>;
}

interface AuthorizationColumns {
  readonly revokedAt: AnyColumn<{ data: string }>;
}

interface OperationActivityColumns {
  readonly status: AnyColumn<{ data: OperationStatus }>;
}

export function isCurrentEnvironment(environment: EnvironmentColumns) {
  return eq(environment.singleton, 1);
}

export function hasNoAutomaticPort(environment: EnvironmentColumns) {
  return isNull(environment.automaticPort);
}

export function isActiveAuthorization(authorization: AuthorizationColumns) {
  return isNull(authorization.revokedAt);
}

export function hasOperationStatus(
  operationActivity: OperationActivityColumns,
  status: OperationStatus,
) {
  return eq(operationActivity.status, status);
}
