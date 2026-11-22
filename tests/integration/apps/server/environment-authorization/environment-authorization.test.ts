import { access, readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import {
  createEnvironmentAuthorization,
  type EnvironmentAuthorization,
} from "#server/features/environment-authorization/environment-authorization.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import { authorizationMetadataTable } from "#server/persistence/environment-state.schema.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

beforeEach(() => {
  vi.useFakeTimers({
    now: new Date("2026-08-21T12:00:00.000Z"),
    toFake: ["Date"],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Environment authorization", () => {
  it("exchanges pairing material once and keeps secrets out of SQLite", async () => {
    const { authorization, context, paths } = await openTestEnvironment();
    const pairing = authorization.createPairing();
    expect(pairing.material).toMatch(/^\d{3}-\d{3}$/);
    const exchanged = await authorization.exchangePairing({
      label: "Alex's workstation",
      pairingMaterial: pairing.material,
    });

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

    const metadata = await context.read(
      "Could not inspect authorization metadata",
      (database) => database.select().from(authorizationMetadataTable).get(),
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

  it("expires pairing material and grants with controlled time", async () => {
    const { authorization } = await openTestEnvironment();
    const expiredPairing = authorization.createPairing();
    advanceClock(10 * 60 * 1_000);
    await expectFailure(
      authorization.exchangePairing({
        label: "Late device",
        pairingMaterial: expiredPairing.material,
      }),
      "ExpiredPairing",
    );

    const viewer = await pairDevice(authorization, "Viewer");
    await authorization.authorize(viewer.credential);
    advanceClock(90 * 24 * 60 * 60 * 1_000);
    await expectFailure(
      authorization.authorize(viewer.credential),
      "ExpiredGrant",
    );
  });

  it("refreshes activity after authentication", async () => {
    const { authorization, context } = await openTestEnvironment();
    const custom = await pairDevice(authorization, "Automation");

    advanceClock(24 * 60 * 60 * 1_000);
    await authorization.authorize(custom.credential);
    const metadata = await context.read(
      "Could not read device activity",
      (database) =>
        database
          .select({ lastSeenAt: authorizationMetadataTable.lastSeenAt })
          .from(authorizationMetadataTable)
          .where(eq(authorizationMetadataTable.id, custom.authorization.id))
          .get(),
    );
    expect(metadata?.lastSeenAt).toBe("2026-08-22T12:00:00.000Z");

    advanceClock(89 * 24 * 60 * 60 * 1_000);
    await authorization.authorize(custom.credential);
  });

  it("blocks revoked grants", async () => {
    const { authorization } = await openTestEnvironment();
    const viewer = await pairDevice(authorization, "Viewer");

    await authorization.revoke(viewer.authorization.id);
    await expectFailure(
      authorization.authorize(viewer.credential),
      "RevokedGrant",
    );
  });

  it("replaces earlier grants with the same label when the pairing asks for it", async () => {
    const { authorization, context } = await openTestEnvironment();
    const browser = await pairDevice(authorization, "Browser");
    const earlierDesktop = await pairDevice(authorization, "Desktop");
    const pairing = authorization.createPairing({
      replacesGrantsWithSameLabel: true,
    });

    const desktop = await authorization.exchangePairing({
      label: "Desktop",
      pairingMaterial: pairing.material,
    });

    const grants = await context.read(
      "Could not read device grants",
      (database) =>
        database
          .select({ id: authorizationMetadataTable.id })
          .from(authorizationMetadataTable)
          .all(),
    );
    expect(grants.map(({ id }) => id).sort()).toEqual(
      [browser.authorization.id, desktop.authorization.id].sort(),
    );
    await expectFailure(
      authorization.authorize(earlierDesktop.credential),
      "InvalidGrant",
    );
  });

  it("allows retrying one-time material after storage failures", async () => {
    const { context } = await openTestEnvironment();
    const failing = createFailingContext(context);
    const authorization = createEnvironmentAuthorization(failing.context);
    const pairing = authorization.createPairing();
    const exchange = {
      label: "Owner",
      pairingMaterial: pairing.material,
    };

    failing.failNextWrite("Could not save device authorization");
    await expect(authorization.exchangePairing(exchange)).rejects.toThrow(
      "Could not save device authorization",
    );
    await expect(
      authorization.exchangePairing(exchange),
    ).resolves.toHaveProperty("credential");
  });
});

function advanceClock(milliseconds: number) {
  vi.setSystemTime(Date.now() + milliseconds);
}

async function pairDevice(
  authorization: EnvironmentAuthorization,
  label: string,
) {
  const pairing = authorization.createPairing();
  return authorization.exchangePairing({
    label,
    pairingMaterial: pairing.material,
  });
}

async function expectFailure(result: Promise<unknown>, tag: string) {
  await expect(result).rejects.toEqual({
    _tag: "EnvironmentAuthorizationError",
    failure: { _tag: tag },
  });
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
      write: (message, operation) => {
        if (message === nextFailure) {
          nextFailure = undefined;
          return Promise.reject(new Error(`${message}: Injected failure`));
        }
        return context.write(message, operation);
      },
    } satisfies EnvironmentContext,
    failNextWrite: (message: string) => {
      nextFailure = message;
    },
  };
}
