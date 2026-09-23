import { eq, isNull } from "drizzle-orm";
import { environmentTable } from "#server/persistence/environment-state.schema";

export function isCurrentEnvironment() {
  return eq(environmentTable.singleton, 1);
}

export function hasNoAutomaticPort() {
  return isNull(environmentTable.automaticPort);
}
