import { randomUUID } from "node:crypto";
import type {
  EnvironmentAuthorizationFailure,
  EnvironmentAuthorizationRevoked,
  EnvironmentDeviceAuthorization,
  EnvironmentPairingExchanged,
  ExchangeEnvironmentPairing,
} from "@rebase/contracts";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import {
  createDeviceCredential,
  createPairingCode,
  createSecretMaterial,
  digestSecretMaterial,
  verifyDeviceCredential,
} from "#server/features/environment-authorization/environment-authorization-secret";
import type { EnvironmentContext } from "#server/persistence/environment-context";
import { authorizationMetadataTable } from "#server/persistence/environment-state.schema";
import type { EnvironmentStorageError } from "#server/persistence/sqlite/storage-operation";

const pairingLifetimeMilliseconds = 10 * 60 * 1_000;
const ticketLifetimeMilliseconds = 30 * 1_000;
const authorizationInactivityMilliseconds = 90 * 24 * 60 * 60 * 1_000;
const retainedMaterialMilliseconds = 24 * 60 * 60 * 1_000;

export class EnvironmentAuthorizationError extends Data.TaggedError(
  "EnvironmentAuthorizationError",
)<{
  readonly failure: EnvironmentAuthorizationFailure;
}> {}

type AuthorizationResult<Value> = Effect.Effect<
  Value,
  EnvironmentAuthorizationError | EnvironmentStorageError
>;

export interface EnvironmentAuthorization {
  readonly authorize: (
    credential: string | undefined,
  ) => AuthorizationResult<EnvironmentDeviceAuthorization>;
  readonly consumeTicket: (
    ticket: string | undefined,
  ) => AuthorizationResult<EnvironmentDeviceAuthorization>;
  readonly createPairing: (pairing?: {
    readonly replacesGrantsWithSameLabel?: boolean;
  }) => Effect.Effect<{
    readonly expiresAt: string;
    readonly material: string;
  }>;
  readonly exchangePairing: (
    exchange: ExchangeEnvironmentPairing,
  ) => AuthorizationResult<EnvironmentPairingExchanged>;
  readonly mintTicket: (credential: string | undefined) => AuthorizationResult<{
    readonly expiresAt: string;
    readonly ticket: string;
  }>;
  readonly revoke: (
    credential: string | undefined,
    authorizationId: string,
  ) => AuthorizationResult<EnvironmentAuthorizationRevoked>;
}

export function createEnvironmentAuthorization(
  context: EnvironmentContext,
): EnvironmentAuthorization {
  const pairings = new Map<string, PairingEntry>();
  const tickets = new Map<string, TicketEntry>();

  return {
    authorize: (credential) => authorizeCredential(context, credential),
    consumeTicket: (ticket) => consumeTicket(context, tickets, ticket),
    createPairing: (pairing) =>
      Effect.sync(() =>
        createPairing(pairings, pairing?.replacesGrantsWithSameLabel ?? false),
      ),
    exchangePairing: (exchange) => exchangePairing(context, pairings, exchange),
    mintTicket: (credential) => mintTicket(context, tickets, credential),
    revoke: (credential, authorizationId) =>
      revokeAuthorization(context, credential, authorizationId),
  };
}

function createPairing(
  pairings: Map<string, PairingEntry>,
  replacesGrantsWithSameLabel: boolean,
) {
  const now = Date.now();
  removeOldMaterial(pairings, now);
  const material = createAvailablePairingCode(pairings);
  const expiresAt = now + pairingLifetimeMilliseconds;
  pairings.set(digestSecretMaterial(material), {
    expiresAt,
    replacesGrantsWithSameLabel,
    used: false,
  });
  return { expiresAt: new Date(expiresAt).toISOString(), material };
}

function createAvailablePairingCode(pairings: Map<string, PairingEntry>) {
  let code = createPairingCode();
  while (pairings.has(digestSecretMaterial(code))) {
    code = createPairingCode();
  }
  return code;
}

function exchangePairing(
  context: EnvironmentContext,
  pairings: Map<string, PairingEntry>,
  exchange: ExchangeEnvironmentPairing,
) {
  return Effect.gen(function* () {
    const now = new Date();
    const pairing = yield* consumePairing(
      pairings,
      exchange.pairingMaterial,
      now,
    );
    const authorization = {
      id: randomUUID(),
      label: exchange.label,
    } satisfies EnvironmentDeviceAuthorization;

    yield* context
      .write("Could not save device authorization", (database) =>
        database.transaction(
          (transaction) => {
            if (pairing.replacesGrantsWithSameLabel) {
              transaction
                .delete(authorizationMetadataTable)
                .where(
                  eq(authorizationMetadataTable.label, authorization.label),
                )
                .run();
            }
            transaction
              .insert(authorizationMetadataTable)
              .values({
                createdAt: now.toISOString(),
                id: authorization.id,
                label: authorization.label,
              })
              .run();
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
      credential: createDeviceCredential(
        context.serverSecret,
        authorization.id,
      ),
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
  credential: string | undefined,
) {
  const authorizationId = verifyDeviceCredential(
    context.serverSecret,
    credential,
  );
  if (authorizationId === undefined) {
    return failAuthorization({ _tag: "InvalidGrant" });
  }
  return authorizeStoredGrant(context, authorizationId);
}

function authorizeStoredGrant(
  context: EnvironmentContext,
  authorizationId: string,
) {
  const now = new Date();
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

      database
        .update(authorizationMetadataTable)
        .set({ lastSeenAt: now.toISOString() })
        .where(eq(authorizationMetadataTable.id, authorizationId))
        .run();

      return authorizationSuccess({ id: metadata.id, label: metadata.label });
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
  tickets: Map<string, TicketEntry>,
  credential: string | undefined,
) {
  return Effect.gen(function* () {
    const authorization = yield* authorizeCredential(context, credential);
    const now = Date.now();
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
  if (Date.now() >= stored.expiresAt) {
    return failAuthorization({ _tag: "ExpiredTicket" });
  }

  stored.used = true;
  return authorizeStoredGrant(context, stored.authorizationId).pipe(
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
  credential: string | undefined,
  authorizationId: string,
) {
  return Effect.gen(function* () {
    yield* authorizeCredential(context, credential);
    const revokedAt = new Date().toISOString();
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
  return Effect.fail(new EnvironmentAuthorizationError({ failure }));
}

interface MaterialEntry {
  readonly expiresAt: number;
  used: boolean;
}

interface PairingEntry extends MaterialEntry {
  readonly replacesGrantsWithSameLabel: boolean;
}

interface TicketEntry extends MaterialEntry {
  readonly authorizationId: string;
}
