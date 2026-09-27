import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createEnvironmentAuthorization,
  type EnvironmentAuthorization,
} from "#server/features/environment-authorization/environment-authorization";
import type { EnvironmentContext } from "#server/persistence/environment-context";
import { authorizationMetadataTable } from "#server/persistence/environment-state.schema";
import { EnvironmentStorageError } from "#server/persistence/sqlite/storage-operation";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
import { openTestEnvironment } from "#tests-support/server";

afterEach(() => {
  vi.useRealTimers();
});

describe("Environment authorization", () => {
  it("exchanges pairing material once and keeps secrets out of SQLite", async () => {
    await withAuthorization(async ({ authorization, context, paths }) => {
      const pairing = await run(authorization.createPairing());
      expect(pairing.material).toMatch(/^\d{3}-\d{3}$/);
      const exchanged = await run(
        authorization.exchangePairing({
          label: "Alex's workstation",
          pairingMaterial: pairing.material,
        }),
      );

      expect(exchanged.authorization).toMatchObject({
        label: "Alex's workstation",
      });
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
      });

      const durableBytes = await readDurableState(paths.stateDatabase);
      expect(durableBytes.includes(exchanged.credential)).toBe(false);
      expect(durableBytes.includes(pairing.material)).toBe(false);
    });
  });

  it("expires pairing material and grants with controlled time", async () => {
    await withAuthorization(async ({ authorization, clock }) => {
      const expiredPairing = await run(authorization.createPairing());
      clock.advance(10 * 60 * 1_000);
      await expectFailure(
        authorization.exchangePairing({
          label: "Late device",
          pairingMaterial: expiredPairing.material,
        }),
        "ExpiredPairing",
      );

      const viewer = await pairDevice(authorization, "Viewer");
      await run(authorization.authorize(viewer.credential));
      clock.advance(90 * 24 * 60 * 60 * 1_000);
      await expectFailure(
        authorization.authorize(viewer.credential),
        "ExpiredGrant",
      );
    });
  });

  it("refreshes activity after authentication", async () => {
    await withAuthorization(async ({ authorization, clock, context }) => {
      const custom = await pairDevice(authorization, "Automation");

      clock.advance(24 * 60 * 60 * 1_000);
      await run(authorization.authorize(custom.credential));
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
      await run(authorization.authorize(custom.credential));
    });
  });

  it("rejects ticket replay and blocks revoked grants", async () => {
    await withAuthorization(async ({ authorization, clock }) => {
      const owner = await pairDevice(authorization, "Owner");
      const viewer = await pairDevice(authorization, "Viewer");
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
        authorization.authorize(viewer.credential),
        "RevokedGrant",
      );
      await expectFailure(
        authorization.mintTicket(viewer.credential),
        "RevokedGrant",
      );
    });
  });

  it("replaces earlier grants with the same label when the pairing asks for it", async () => {
    await withAuthorization(async ({ authorization, context }) => {
      const browser = await pairDevice(authorization, "Browser");
      const earlierDesktop = await pairDevice(authorization, "Desktop");
      const pairing = await run(
        authorization.createPairing({ replacesGrantsWithSameLabel: true }),
      );

      const desktop = await run(
        authorization.exchangePairing({
          label: "Desktop",
          pairingMaterial: pairing.material,
        }),
      );

      const grants = await run(
        context.read("Could not read device grants", (database) =>
          database
            .select({ id: authorizationMetadataTable.id })
            .from(authorizationMetadataTable)
            .all(),
        ),
      );
      expect(grants.map(({ id }) => id).sort()).toEqual(
        [browser.authorization.id, desktop.authorization.id].sort(),
      );
      await expectFailure(
        authorization.authorize(earlierDesktop.credential),
        "InvalidGrant",
      );
    });
  });

  it("allows retrying one-time material after storage failures", async () => {
    await withAuthorization(async ({ context }) => {
      const failing = createFailingContext(context);
      const authorization = createEnvironmentAuthorization(failing.context);
      const pairing = await run(authorization.createPairing());
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

async function withAuthorization(
  use: (fixture: AuthorizationFixture) => Promise<void>,
) {
  vi.useFakeTimers({
    now: new Date("2026-08-21T12:00:00.000Z"),
    toFake: ["Date"],
  });
  const environment = await openTestEnvironment();
  await use({
    authorization: environment.authorization,
    clock: {
      advance: (milliseconds) => vi.setSystemTime(Date.now() + milliseconds),
    },
    context: environment.context,
    paths: environmentPaths(join(environment.home, ".rebase")),
  });
}

async function pairDevice(
  authorization: EnvironmentAuthorization,
  label: string,
) {
  const pairing = await run(authorization.createPairing());
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
  readonly clock: { readonly advance: (milliseconds: number) => void };
  readonly context: EnvironmentContext;
  readonly paths: ReturnType<typeof environmentPaths>;
}
