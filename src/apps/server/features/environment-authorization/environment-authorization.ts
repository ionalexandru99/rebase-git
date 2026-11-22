import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  EnvironmentAuthorizationApi,
  type EnvironmentAuthorizationFailure,
  type EnvironmentAuthorizationRevoked,
  type EnvironmentDeviceAuthorization,
  type EnvironmentPairingExchanged,
  type ExchangeEnvironmentPairing,
  type InvalidGrant,
} from "#contracts/environment-authorization/environment-authorization.contract.ts";
import {
  type EnvironmentFeature,
  route,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  createDeviceCredential,
  createPairingCode,
  digestSecretMaterial,
  verifyDeviceCredential,
} from "#server/features/environment-authorization/environment-authorization-secret.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import { authorizationMetadataTable } from "#server/persistence/environment-state.schema.ts";

const pairingLifetimeMilliseconds = 10 * 60 * 1_000;
const authorizationInactivityMilliseconds = 90 * 24 * 60 * 60 * 1_000;
const retainedMaterialMilliseconds = 24 * 60 * 60 * 1_000;

export interface EnvironmentAuthorizationError {
  readonly _tag: "EnvironmentAuthorizationError";
  readonly failure: EnvironmentAuthorizationFailure;
}

export function environmentAuthorizationError(
  failure: EnvironmentAuthorizationFailure,
): EnvironmentAuthorizationError {
  return { _tag: "EnvironmentAuthorizationError", failure };
}

export function isEnvironmentAuthorizationError(
  error: unknown,
): error is EnvironmentAuthorizationError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "EnvironmentAuthorizationError"
  );
}

export interface EnvironmentAuthorization {
  readonly authorize: (
    credential: string | undefined,
  ) => Promise<EnvironmentDeviceAuthorization>;
  readonly createPairing: (pairing?: {
    readonly replacesGrantsWithSameLabel?: boolean;
  }) => {
    readonly expiresAt: string;
    readonly material: string;
  };
  readonly exchangePairing: (
    exchange: ExchangeEnvironmentPairing,
  ) => Promise<EnvironmentPairingExchanged>;
  readonly revoke: (
    authorizationId: string,
  ) => Promise<EnvironmentAuthorizationRevoked>;
  readonly watchRevocation: (
    authorizationId: string,
    revoked: () => void,
  ) => () => void;
}

export function environmentAuthorizationFeature(
  authorization: EnvironmentAuthorization,
): EnvironmentFeature {
  const api = EnvironmentAuthorizationApi;
  return {
    routes: [
      route(api.createPairing, async (_, context) => {
        const created = authorization.createPairing();
        return {
          expiresAt: created.expiresAt,
          pairingUrl: `${context.origin}/pair#${created.material}`,
        };
      }),
      route(api.revokeAuthorization, (revocation) =>
        authorization.revoke(revocation.authorizationId),
      ),
    ],
  };
}

export function createEnvironmentAuthorization(
  context: EnvironmentContext,
): EnvironmentAuthorization {
  const pairings = new Map<string, PairingEntry>();
  const revocationWatchers = new Map<string, Set<() => void>>();
  const revokedAuthorizations = new Set<string>();

  return {
    authorize: (credential) => authorizeCredential(context, credential),
    createPairing: (pairing) =>
      createPairing(pairings, pairing?.replacesGrantsWithSameLabel ?? false),
    exchangePairing: (exchange) => exchangePairing(context, pairings, exchange),
    revoke: async (authorizationId) => {
      const revoked = await revokeAuthorization(context, authorizationId);
      revokedAuthorizations.add(authorizationId);
      for (const watcher of revocationWatchers.get(authorizationId) ?? [])
        watcher();
      return revoked;
    },
    watchRevocation: (authorizationId, revoked) => {
      if (revokedAuthorizations.has(authorizationId)) {
        revoked();
        return () => {};
      }
      const watchers = revocationWatchers.get(authorizationId) ?? new Set();
      watchers.add(revoked);
      revocationWatchers.set(authorizationId, watchers);
      return () => {
        watchers.delete(revoked);
        if (watchers.size === 0) revocationWatchers.delete(authorizationId);
      };
    },
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

async function exchangePairing(
  context: EnvironmentContext,
  pairings: Map<string, PairingEntry>,
  exchange: ExchangeEnvironmentPairing,
) {
  const now = new Date();
  const pairing = consumePairing(pairings, exchange.pairingMaterial, now);
  const authorization = {
    id: randomUUID(),
    label: exchange.label,
  } satisfies EnvironmentDeviceAuthorization;

  try {
    await context.write("Could not save device authorization", (database) =>
      database.transaction(
        (transaction) => {
          if (pairing.replacesGrantsWithSameLabel) {
            transaction
              .delete(authorizationMetadataTable)
              .where(eq(authorizationMetadataTable.label, authorization.label))
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
    );
  } catch (error) {
    pairing.used = false;
    throw error;
  }

  return {
    authorization,
    credential: createDeviceCredential(context.serverSecret, authorization.id),
  };
}

function consumePairing(
  pairings: Map<string, PairingEntry>,
  material: string,
  now: Date,
) {
  const pairing = pairings.get(digestSecretMaterial(material));
  if (pairing === undefined) {
    throw environmentAuthorizationError({ _tag: "InvalidPairing" });
  }
  if (pairing.used) {
    throw environmentAuthorizationError({ _tag: "PairingAlreadyUsed" });
  }
  if (now.getTime() >= pairing.expiresAt) {
    throw environmentAuthorizationError({ _tag: "ExpiredPairing" });
  }

  pairing.used = true;
  return pairing;
}

async function authorizeCredential(
  context: EnvironmentContext,
  credential: string | undefined,
) {
  const authorizationId = verifyDeviceCredential(
    context.serverSecret,
    credential,
  );
  if (authorizationId === undefined) {
    throw environmentAuthorizationError({ _tag: "InvalidGrant" });
  }
  return authorizeStoredGrant(context, authorizationId);
}

async function authorizeStoredGrant(
  context: EnvironmentContext,
  authorizationId: string,
) {
  const now = new Date();
  const result = await context.write(
    "Could not authenticate device authorization",
    (database) => {
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
    },
  );
  if (!result.success) throw environmentAuthorizationError(result.failure);
  return result.authorization;
}

async function revokeAuthorization(
  context: EnvironmentContext,
  authorizationId: string,
) {
  const revokedAt = new Date().toISOString();
  const revoked = await context.write(
    "Could not revoke device authorization",
    (database) =>
      database
        .update(authorizationMetadataTable)
        .set({ revokedAt })
        .where(eq(authorizationMetadataTable.id, authorizationId))
        .run().changes > 0,
  );
  if (!revoked) {
    throw { _tag: "InvalidGrant" } satisfies InvalidGrant;
  }
  return { authorizationId, revokedAt };
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

interface PairingEntry {
  readonly expiresAt: number;
  readonly replacesGrantsWithSameLabel: boolean;
  used: boolean;
}
