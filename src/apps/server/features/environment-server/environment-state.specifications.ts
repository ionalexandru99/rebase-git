import { eq, isNull } from "drizzle-orm";
import type { OperationStatus } from "#server/domain/environment-state.contract";
import {
  authorizationMetadataTable,
  environmentTable,
  operationActivityTable,
} from "#server/persistence/environment-state.schema";

export function isCurrentEnvironment() {
  return eq(environmentTable.singleton, 1);
}

export function hasNoAutomaticPort() {
  return isNull(environmentTable.automaticPort);
}

export function isActiveAuthorization() {
  return isNull(authorizationMetadataTable.revokedAt);
}

export function hasOperationStatus(status: OperationStatus) {
  return eq(operationActivityTable.status, status);
}
