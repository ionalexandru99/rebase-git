import { randomUUID } from "node:crypto";
import type {
  CreateEnvironmentPairing,
  EnvironmentAccessCapability,
  EnvironmentAuthorizationFailure,
  EnvironmentAuthorizationRole,
  EnvironmentDeviceAuthorization,
  ExchangeEnvironmentPairing,
} from "@rebase/contracts";
import type {
  EnvironmentAuthorization,
  EnvironmentAuthorizationClock,
  EnvironmentAuthorizationOptions,
} from "@rebase/server/features/environment-authorization/environment-authorization.contract";
import { EnvironmentAuthorizationError } from "@rebase/server/features/environment-authorization/environment-authorization.contract";
import {
  createDeviceCredential,
  createSecretMaterial,
  digestSecretMaterial,
  verifyDeviceCredential,
} from "@rebase/server/features/environment-authorization/environment-authorization-secret";
import { capabilitiesForRole } from "@rebase/server/features/environment-authorization/environment-capabilities";
import type { EnvironmentContext } from "@rebase/server/persistence/environment-context.contract";
import {
  authorizationCapabilityTable,
  authorizationMetadataTable,
} from "@rebase/server/persistence/environment-state.schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

const pairingLifetimeMilliseconds = 10 * 60 * 1_000;
const ticketLifetimeMilliseconds = 30 * 1_000;
const authorizationInactivityMilliseconds = 90 * 24 * 60 * 60 * 1_000;
const retainedMaterialMilliseconds = 24 * 60 * 60 * 1_000;

export function createEnvironmentAuthorization(
  context: EnvironmentContext,
  serverSecret: string,
  options: EnvironmentAuthorizationOptions = {},
): EnvironmentAuthorization {
  const clock = options.clock ?? systemClock;
  const pairings = new Map<string, PairingEntry>();
  const tickets = new Map<string, TicketEntry>();

  return {
    authorize: (credential, capability) =>
      authorizeCredential(context, serverSecret, clock, credential, capability),
    consumeTicket: (ticket) => consumeTicket(context, clock, tickets, ticket),
    createPairing: (pairing) =>
      Effect.sync(() => createPairing(clock, pairings, pairing)),
    exchangePairing: (exchange) =>
      exchangePairing(context, serverSecret, clock, pairings, exchange),
    mintTicket: (credential) =>
      mintTicket(context, serverSecret, clock, tickets, credential),
    revoke: (credential, authorizationId) =>
      revokeAuthorization(
        context,
        serverSecret,
        clock,
        credential,
        authorizationId,
      ),
  };
}

function createPairing(
  clock: EnvironmentAuthorizationClock,
  pairings: Map<string, PairingEntry>,
  pairing: CreateEnvironmentPairing,
) {
  const now = clock.now().getTime();
  removeOldMaterial(pairings, now);
  const material = createSecretMaterial();
  const expiresAt = now + pairingLifetimeMilliseconds;
  pairings.set(digestSecretMaterial(material), {
    capabilities: capabilitiesForRole(pairing.role, pairing.capabilities),
    expiresAt,
    role: pairing.role,
    used: false,
  });
  return { expiresAt: new Date(expiresAt).toISOString(), material };
}

function exchangePairing(
  context: EnvironmentContext,
  serverSecret: string,
  clock: EnvironmentAuthorizationClock,
  pairings: Map<string, PairingEntry>,
  exchange: ExchangeEnvironmentPairing,
) {
  return Effect.gen(function* () {
    const now = clock.now();
    const pairing = yield* consumePairing(
      pairings,
      exchange.pairingMaterial,
      now,
    );
    const authorization = {
      capabilities: pairing.capabilities,
      id: randomUUID(),
      label: exchange.label,
      role: pairing.role,
    } satisfies EnvironmentDeviceAuthorization;

    yield* context
      .write("Could not save device authorization", (database) =>
        database.transaction(
          (transaction) => {
            transaction
              .insert(authorizationMetadataTable)
              .values({
                createdAt: now.toISOString(),
                id: authorization.id,
                label: authorization.label,
                role: authorization.role,
              })
              .run();
            if (
              authorization.role === "custom" &&
              authorization.capabilities.length > 0
            ) {
              transaction
                .insert(authorizationCapabilityTable)
                .values(
                  authorization.capabilities.map((capability) => ({
                    authorizationId: authorization.id,
                    capability,
                  })),
                )
                .run();
            }
          },
          { behavior: "immediate" },
        ),
      )
      .pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            pairing.used = false;
          }),
        ),
      );

    return {
      authorization,
      credential: createDeviceCredential(serverSecret, authorization.id),
    };
  });
}

function consumePairing(
  pairings: Map<string, PairingEntry>,
  material: string,
  now: Date,
) {
  const pairing = pairings.get(digestSecretMaterial(material));
  if (pairing === undefined) {
    return failAuthorization({ _tag: "InvalidPairing" });
  }
  if (pairing.used) {
    return failAuthorization({ _tag: "PairingAlreadyUsed" });
  }
  if (now.getTime() >= pairing.expiresAt) {
    return failAuthorization({ _tag: "ExpiredPairing" });
  }

  pairing.used = true;
  return Effect.succeed(pairing);
}

function authorizeCredential(
  context: EnvironmentContext,
  serverSecret: string,
  clock: EnvironmentAuthorizationClock,
  credential: string | undefined,
  capability: EnvironmentAccessCapability,
) {
  const authorizationId = verifyDeviceCredential(serverSecret, credential);
  if (authorizationId === undefined) {
    return failAuthorization({ _tag: "InvalidGrant" });
  }
  return authorizeStoredGrant(context, clock, authorizationId, capability);
}

function authorizeStoredGrant(
  context: EnvironmentContext,
  clock: EnvironmentAuthorizationClock,
  authorizationId: string,
  capability: EnvironmentAccessCapability,
) {
  const now = clock.now();
  return context
    .write("Could not authenticate device authorization", (database) => {
      const metadata = database
        .select()
        .from(authorizationMetadataTable)
        .where(eq(authorizationMetadataTable.id, authorizationId))
        .get();
      if (metadata === undefined) {
        return authorizationFailure({ _tag: "InvalidGrant" });
      }
      if (metadata.revokedAt !== null) {
        return authorizationFailure({ _tag: "RevokedGrant" });
      }

      const activeSince = new Date(
        metadata.lastSeenAt ?? metadata.createdAt,
      ).getTime();
      if (now.getTime() - activeSince >= authorizationInactivityMilliseconds) {
        return authorizationFailure({ _tag: "ExpiredGrant" });
      }

      const capabilities = capabilitiesForRole(
        metadata.role,
        metadata.role === "custom"
          ? database
              .select({ capability: authorizationCapabilityTable.capability })
              .from(authorizationCapabilityTable)
              .where(
                eq(
                  authorizationCapabilityTable.authorizationId,
                  authorizationId,
                ),
              )
              .all()
              .map(({ capability: storedCapability }) => storedCapability)
          : [],
      );
      database
        .update(authorizationMetadataTable)
        .set({ lastSeenAt: now.toISOString() })
        .where(eq(authorizationMetadataTable.id, authorizationId))
        .run();

      if (!capabilities.includes(capability)) {
        return authorizationFailure({ _tag: "CapabilityDenied", capability });
      }

      return authorizationSuccess({
        capabilities,
        id: metadata.id,
        label: metadata.label,
        role: metadata.role,
      });
    })
    .pipe(
      Effect.flatMap((result) =>
        result.success
          ? Effect.succeed(result.authorization)
          : failAuthorization(result.failure),
      ),
    );
}

function mintTicket(
  context: EnvironmentContext,
  serverSecret: string,
  clock: EnvironmentAuthorizationClock,
  tickets: Map<string, TicketEntry>,
  credential: string | undefined,
) {
  return Effect.gen(function* () {
    const authorization = yield* authorizeCredential(
      context,
      serverSecret,
      clock,
      credential,
      "environment.read",
    );
    const now = clock.now().getTime();
    removeOldMaterial(tickets, now);
    const ticket = createSecretMaterial();
    const expiresAt = now + ticketLifetimeMilliseconds;
    tickets.set(digestSecretMaterial(ticket), {
      authorizationId: authorization.id,
      expiresAt,
      used: false,
    });
    return { expiresAt: new Date(expiresAt).toISOString(), ticket };
  });
}

function consumeTicket(
  context: EnvironmentContext,
  clock: EnvironmentAuthorizationClock,
  tickets: Map<string, TicketEntry>,
  ticket: string | undefined,
) {
  if (ticket === undefined) {
    return failAuthorization({ _tag: "InvalidTicket" });
  }
  const stored = tickets.get(digestSecretMaterial(ticket));
  if (stored === undefined) {
    return failAuthorization({ _tag: "InvalidTicket" });
  }
  if (stored.used) {
    return failAuthorization({ _tag: "TicketAlreadyUsed" });
  }
  if (clock.now().getTime() >= stored.expiresAt) {
    return failAuthorization({ _tag: "ExpiredTicket" });
  }

  stored.used = true;
  return authorizeStoredGrant(
    context,
    clock,
    stored.authorizationId,
    "environment.read",
  ).pipe(
    Effect.tapError((error) =>
      error._tag === "EnvironmentStorageError"
        ? Effect.sync(() => {
            stored.used = false;
          })
        : Effect.void,
    ),
  );
}

function revokeAuthorization(
  context: EnvironmentContext,
  serverSecret: string,
  clock: EnvironmentAuthorizationClock,
  credential: string | undefined,
  authorizationId: string,
) {
  return Effect.gen(function* () {
    yield* authorizeCredential(
      context,
      serverSecret,
      clock,
      credential,
      "authorization.manage",
    );
    const revokedAt = clock.now().toISOString();
    const revoked = yield* context.write(
      "Could not revoke device authorization",
      (database) =>
        database
          .update(authorizationMetadataTable)
          .set({ revokedAt })
          .where(eq(authorizationMetadataTable.id, authorizationId))
          .run().changes > 0,
    );
    if (!revoked) {
      return yield* failAuthorization({ _tag: "InvalidGrant" });
    }
    return { authorizationId, revokedAt };
  });
}

function removeOldMaterial<Entry extends MaterialEntry>(
  entries: Map<string, Entry>,
  now: number,
) {
  for (const [digest, entry] of entries) {
    if (entry.expiresAt + retainedMaterialMilliseconds <= now) {
      entries.delete(digest);
    }
  }
}

function authorizationFailure(failure: EnvironmentAuthorizationFailure) {
  return { failure, success: false as const };
}

function authorizationSuccess(authorization: EnvironmentDeviceAuthorization) {
  return { authorization, success: true as const };
}

function failAuthorization(failure: EnvironmentAuthorizationFailure) {
  return Effect.fail(new EnvironmentAuthorizationError(failure));
}

const systemClock: EnvironmentAuthorizationClock = {
  now: () => new Date(),
};

interface MaterialEntry {
  readonly expiresAt: number;
  used: boolean;
}

interface PairingEntry extends MaterialEntry {
  readonly capabilities: ReadonlyArray<EnvironmentAccessCapability>;
  readonly role: EnvironmentAuthorizationRole;
}

interface TicketEntry extends MaterialEntry {
  readonly authorizationId: string;
}
