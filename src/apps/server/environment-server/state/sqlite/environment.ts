import { randomUUID } from "node:crypto";
import { environmentTable } from "@rebase/server/environment-server/state/sqlite/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

export async function initializeEnvironmentRecord(
  database: NodeSQLiteDatabase,
) {
  await database
    .insert(environmentTable)
    .values({ id: randomUUID(), singleton: 1 })
    .onConflictDoNothing({ target: environmentTable.singleton });
  const environment = await database
    .select()
    .from(environmentTable)
    .where(eq(environmentTable.singleton, 1))
    .get();
  if (environment === undefined) {
    throw new Error("The Environment identity is missing.");
  }
  return environment;
}

export async function selectAutomaticPort(
  database: NodeSQLiteDatabase,
  port: number,
) {
  await database
    .update(environmentTable)
    .set({ automaticPort: port })
    .where(
      and(
        eq(environmentTable.singleton, 1),
        isNull(environmentTable.automaticPort),
      ),
    );
  const selected = await database
    .select({ automaticPort: environmentTable.automaticPort })
    .from(environmentTable)
    .where(eq(environmentTable.singleton, 1))
    .get();
  if (selected?.automaticPort === null || selected === undefined) {
    throw new Error("The automatic port was not saved.");
  }
  if (selected.automaticPort !== port) {
    throw new Error(
      `Another server selected automatic port ${selected.automaticPort}.`,
    );
  }
  return selected.automaticPort;
}
