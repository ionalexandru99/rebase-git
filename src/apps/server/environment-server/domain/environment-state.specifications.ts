import type { OperationStatus } from "@rebase/server/environment-server/domain/environment-state.contract";
import {
  authorizationMetadataTable,
  environmentTable,
  operationActivityTable,
} from "@rebase/server/environment-server/domain/environment-state.schema";
import { eq, isNull } from "drizzle-orm";

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
