import type { AuthorizationMetadata } from "@rebase/server/environment-server/state/environment-state.contract";
import { authorizationMetadataTable } from "@rebase/server/environment-server/state/sqlite/schema";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

export function listAuthorizationMetadata(database: NodeSQLiteDatabase) {
  return database
    .select()
    .from(authorizationMetadataTable)
    .orderBy(authorizationMetadataTable.createdAt);
}

export async function saveAuthorizationMetadata(
  database: NodeSQLiteDatabase,
  authorization: AuthorizationMetadata,
) {
  await database
    .insert(authorizationMetadataTable)
    .values(authorization)
    .onConflictDoUpdate({
      set: authorization,
      target: authorizationMetadataTable.id,
    });
}
