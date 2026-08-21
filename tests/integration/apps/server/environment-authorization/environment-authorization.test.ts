import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CreateEnvironmentPairing,
  EnvironmentAuthorizationRole,
} from "@rebase/contracts";
import { createEnvironmentAuthorization } from "@rebase/server/features/environment-authorization/environment-authorization";
import type {
  EnvironmentAuthorization,
  EnvironmentAuthorizationClock,
} from "@rebase/server/features/environment-authorization/environment-authorization.contract";
import { acquireEnvironmentContext } from "@rebase/server/persistence/environment-context";
import type { EnvironmentContext } from "@rebase/server/persistence/environment-context.contract";
import { authorizationMetadataTable } from "@rebase/server/persistence/environment-state.schema";
import { environmentPaths } from "@rebase/server/persistence/storage/environment-paths";
import { EnvironmentStorageError } from "@rebase/server/persistence/storage/storage-error.contract";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  directories.clear();
});

describe("Environment authorization", () => {
  it("exchanges pairing material once and keeps secrets out of SQLite", async () => {
    await withAuthorization(async ({ authorization, context, paths }) => {
      const pairing = await run(
        authorization.createPairing({ capabilities: [], role: "owner" }),
      );
      const exchanged = await run(
        authorization.exchangePairing({
          label: "Alex's workstation",
          pairingMaterial: pairing.material,
        }),
      );

      expect(exchanged.authorization).toMatchObject({
        label: "Alex's workstation",
        role: "owner",
      });
      expect(exchanged.authorization.capabilities).toContain(
        "authorization.manage",
      );
      await expectFailure(
        authorization.exchangePairing({
          label: "Replay",
          pairingMaterial: pairing.material,
        }),
        "PairingAlreadyUsed",
      );

      const metadata = await run(
        context.read("Could not inspect authorization metadata", (database) =>
          database.select().from(authorizationMetadataTable).get(),
        ),
      );
      expect(metadata).toEqual({
        createdAt: "2026-08-21T12:00:00.000Z",
        id: exchanged.authorization.id,
        label: "Alex's workstation",
        lastSeenAt: null,
        revokedAt: null,
        role: "owner",
      });

      const durableBytes = await readDurableState(paths.stateDatabase);
      expect(durableBytes.includes(exchanged.credential)).toBe(false);
      expect(durableBytes.includes(pairing.material)).toBe(false);
    });
  });

  it("expires pairing material and grants with controlled time", async () => {
    await withAuthorization(async ({ authorization, clock }) => {
      const expiredPairing = await run(
        authorization.createPairing({ capabilities: [], role: "viewer" }),
      );
      clock.advance(10 * 60 * 1_000);
      await expectFailure(
        authorization.exchangePairing({
          label: "Late device",
          pairingMaterial: expiredPairing.material,
        }),
        "ExpiredPairing",
      );

      const viewer = await pairDevice(authorization, "viewer", "Viewer");
      await run(authorization.authorize(viewer.credential, "environment.read"));
      clock.advance(90 * 24 * 60 * 60 * 1_000);
      await expectFailure(
        authorization.authorize(viewer.credential, "environment.read"),
        "ExpiredGrant",
      );
    });
  });

  it("refreshes activity after authentication and enforces capabilities", async () => {
    await withAuthorization(async ({ authorization, clock, context }) => {
      const custom = await pairDevice(
        authorization,
        "custom",
        "Read-only automation",
        ["repository.read"],
      );

      clock.advance(24 * 60 * 60 * 1_000);
      await expectFailure(
        authorization.authorize(custom.credential, "repository.write"),
        "CapabilityDenied",
      );
      const metadata = await run(
        context.read("Could not read device activity", (database) =>
          database
            .select({ lastSeenAt: authorizationMetadataTable.lastSeenAt })
            .from(authorizationMetadataTable)
            .where(eq(authorizationMetadataTable.id, custom.authorization.id))
            .get(),
        ),
      );
      expect(metadata?.lastSeenAt).toBe("2026-08-22T12:00:00.000Z");

      clock.advance(89 * 24 * 60 * 60 * 1_000);
      await run(authorization.authorize(custom.credential, "repository.read"));
    });
  });

  it("rejects ticket replay and blocks revoked grants", async () => {
    await withAuthorization(async ({ authorization, clock }) => {
      const owner = await pairDevice(authorization, "owner", "Owner");
      const viewer = await pairDevice(authorization, "viewer", "Viewer");
      const ticket = await run(authorization.mintTicket(viewer.credential));
      await run(authorization.consumeTicket(ticket.ticket));
      await expectFailure(
        authorization.consumeTicket(ticket.ticket),
        "TicketAlreadyUsed",
      );

      const expiredTicket = await run(
        authorization.mintTicket(viewer.credential),
      );
      clock.advance(30_000);
      await expectFailure(
        authorization.consumeTicket(expiredTicket.ticket),
        "ExpiredTicket",
      );

      await run(
        authorization.revoke(owner.credential, viewer.authorization.id),
      );
      await expectFailure(
        authorization.authorize(viewer.credential, "environment.read"),
        "RevokedGrant",
      );
      await expectFailure(
        authorization.mintTicket(viewer.credential),
        "RevokedGrant",
      );
    });
  });

  it("allows retrying one-time material after storage failures", async () => {
    await withAuthorization(async ({ clock, context }) => {
      const failing = createFailingContext(context);
      const authorization = createEnvironmentAuthorization(
        failing.context,
        context.serverSecret,
        { clock },
      );
      const pairing = await run(
        authorization.createPairing({ capabilities: [], role: "owner" }),
      );
      const exchange = {
        label: "Owner",
        pairingMaterial: pairing.material,
      };

      failing.failNextWrite("Could not save device authorization");
      await expectStorageFailure(authorization.exchangePairing(exchange));
      const owner = await run(authorization.exchangePairing(exchange));

      const ticket = await run(authorization.mintTicket(owner.credential));
      failing.failNextWrite("Could not authenticate device authorization");
      await expectStorageFailure(authorization.consumeTicket(ticket.ticket));
      await expect(
        run(authorization.consumeTicket(ticket.ticket)),
      ).resolves.toMatchObject({ id: owner.authorization.id });
    });
  });
});

function withAuthorization(
  use: (fixture: AuthorizationFixture) => Promise<void>,
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "rebase authorization ")),
        );
        directories.add(directory);
        const paths = environmentPaths(join(directory, ".rebase"));
        const context = yield* acquireEnvironmentContext(paths);
        const clock = createClock();
        const authorization = createEnvironmentAuthorization(
          context,
          context.serverSecret,
          { clock },
        );
        yield* Effect.promise(() =>
          use({ authorization, clock, context, paths }),
        );
      }),
    ),
  );
}

async function pairDevice(
  authorization: EnvironmentAuthorization,
  role: EnvironmentAuthorizationRole,
  label: string,
  capabilities: CreateEnvironmentPairing["capabilities"] = [],
) {
  const pairing = await run(
    authorization.createPairing({ capabilities, role }),
  );
  return run(
    authorization.exchangePairing({
      label,
      pairingMaterial: pairing.material,
    }),
  );
}

async function expectFailure(
  effect: Effect.Effect<unknown, unknown>,
  tag: string,
) {
  await expect(run(effect)).rejects.toMatchObject({
    failure: { _tag: tag },
  });
}

async function expectStorageFailure(effect: Effect.Effect<unknown, unknown>) {
  await expect(run(effect)).rejects.toMatchObject({
    _tag: "EnvironmentStorageError",
  });
}

function run<Value, Error>(effect: Effect.Effect<Value, Error>) {
  return Effect.runPromise(effect);
}

function createClock() {
  let current = new Date("2026-08-21T12:00:00.000Z").getTime();
  return {
    advance: (milliseconds: number) => {
      current += milliseconds;
    },
    now: () => new Date(current),
  } satisfies EnvironmentAuthorizationClock & {
    readonly advance: (milliseconds: number) => void;
  };
}

async function readDurableState(databasePath: string) {
  const files = [databasePath, `${databasePath}-wal`];
  const contents: Buffer[] = [];
  for (const file of files) {
    try {
      await access(file);
      contents.push(await readFile(file));
    } catch {}
  }
  return Buffer.concat(contents).toString("utf8");
}

function createFailingContext(context: EnvironmentContext) {
  let nextFailure: string | undefined;
  return {
    context: {
      ...context,
      write: <Value>(
        message: string,
        operation: Parameters<EnvironmentContext["write"]>[1],
      ) => {
        if (message === nextFailure) {
          nextFailure = undefined;
          return Effect.fail(
            new EnvironmentStorageError({
              cause: new Error("Injected storage failure"),
              message,
            }),
          );
        }
        return context.write(message, operation) as Effect.Effect<
          Value,
          EnvironmentStorageError
        >;
      },
    } satisfies EnvironmentContext,
    failNextWrite: (message: string) => {
      nextFailure = message;
    },
  };
}

interface AuthorizationFixture {
  readonly authorization: EnvironmentAuthorization;
  readonly clock: EnvironmentAuthorizationClock & {
    readonly advance: (milliseconds: number) => void;
  };
  readonly context: EnvironmentContext;
  readonly paths: ReturnType<typeof environmentPaths>;
}
