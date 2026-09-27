import { randomUUID } from "node:crypto";
import type {
  EnvironmentAuthorizationFailure,
  EnvironmentAuthorizationRevoked,
  EnvironmentDeviceAuthorization,
  EnvironmentPairingExchanged,
  ExchangeEnvironmentPairing,
  InvalidGrant,
} from "@rebase/contracts";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import {
  createDeviceCredential,
  createPairingCode,
  digestSecretMaterial,
  verifyDeviceCredential,
} from "#server/features/environment-authorization/environment-authorization-secret";
import type { EnvironmentContext } from "#server/persistence/environment-context";
import { authorizationMetadataTable } from "#server/persistence/environment-state.schema";
import type { EnvironmentStorageError } from "#server/persistence/sqlite/storage-operation";

const pairingLifetimeMilliseconds = 10 * 60 * 1_000;
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
  readonly createPairing: (pairing?: {
    readonly replacesGrantsWithSameLabel?: boolean;
  }) => Effect.Effect<{
    readonly expiresAt: string;
    readonly material: string;
  }>;
  readonly exchangePairing: (
    exchange: ExchangeEnvironmentPairing,
  ) => AuthorizationResult<EnvironmentPairingExchanged>;
  readonly revoke: (
    authorizationId: string,
  ) => Effect.Effect<
    EnvironmentAuthorizationRevoked,
    InvalidGrant | EnvironmentStorageError
  >;
}

export function createEnvironmentAuthorization(
  context: EnvironmentContext,
): EnvironmentAuthorization {
  const pairings = new Map<string, PairingEntry>();

  return {
    authorize: (credential) => authorizeCredential(context, credential),
    createPairing: (pairing) =>
      Effect.sync(() =>
        createPairing(pairings, pairing?.replacesGrantsWithSameLabel ?? false),
      ),
    exchangePairing: (exchange) => exchangePairing(context, pairings, exchange),
    revoke: (authorizationId) => revokeAuthorization(context, authorizationId),
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

function revokeAuthorization(
  context: EnvironmentContext,
  authorizationId: string,
) {
  return Effect.gen(function* () {
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
      return yield* Effect.fail<InvalidGrant>({ _tag: "InvalidGrant" });
    }
    return { authorizationId, revokedAt };
  });
}

function removeOldMaterial(entries: Map<string, PairingEntry>, now: number) {
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

interface PairingEntry {
  readonly expiresAt: number;
  readonly replacesGrantsWithSameLabel: boolean;
  used: boolean;
}
