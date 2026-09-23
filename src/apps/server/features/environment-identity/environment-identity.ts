import { and } from "drizzle-orm";
import { Effect, Layer } from "effect";
import {
  type Environment,
  EnvironmentIdentity,
  type EnvironmentIdentityService,
} from "#server/domain/environment-identity.contract";
import {
  hasNoAutomaticPort,
  isCurrentEnvironment,
} from "#server/features/environment-identity/environment-identity.specifications";
import type { EnvironmentContext } from "#server/persistence/environment-context.contract";
import { EnvironmentStorage } from "#server/persistence/environment-context.contract";
import { environmentTable } from "#server/persistence/environment-state.schema";

export function createEnvironmentIdentity(
  context: EnvironmentContext,
): EnvironmentIdentityService {
  return {
    current: () => readCurrentEnvironment(context),
    claimAutomaticPort: (port) => claimAutomaticPort(context, port),
  };
}

export const environmentIdentityLayer = Layer.effect(
  EnvironmentIdentity,
  Effect.map(EnvironmentStorage, createEnvironmentIdentity),
);

function readCurrentEnvironment(context: EnvironmentContext) {
  return context.read("Could not read Environment state", async (database) => {
    const environment = await database
      .select()
      .from(environmentTable)
      .where(isCurrentEnvironment())
      .get();
    if (environment === undefined) {
      throw new Error("The Environment identity is missing.");
    }
    return environment satisfies Environment;
  });
}

function claimAutomaticPort(context: EnvironmentContext, port: number) {
  return context.write(
    "Could not save the automatic port",
    async (database) => {
      await database
        .update(environmentTable)
        .set({ automaticPort: port })
        .where(and(isCurrentEnvironment(), hasNoAutomaticPort()));
      const selected = await database
        .select({ automaticPort: environmentTable.automaticPort })
        .from(environmentTable)
        .where(isCurrentEnvironment())
        .get();
      if (selected?.automaticPort === null || selected === undefined) {
        throw new Error("The automatic port was not saved.");
      }
      if (selected.automaticPort !== port) {
        throw new Error(
          `Another server selected automatic port ${selected.automaticPort}.`,
        );
      }
    },
  );
}
