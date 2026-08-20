import { createCurrentEnvironmentHello } from "@rebase/contracts";
import { createEnvironmentEventPublisher } from "@rebase/server/features/environment-connection/environment-event-publisher";
import type { EnvironmentEventPublisher } from "@rebase/server/features/environment-connection/environment-event-publisher.contract";
import { acquireEnvironmentListener } from "@rebase/server/features/environment-server/server/environment-listener";
import {
  connectCurrentEnvironment,
  connectEnvironment,
  EnvironmentHelloRejected,
  EnvironmentResponseError,
  fetchEnvironmentDiscovery,
  fetchEnvironmentSnapshot,
} from "@rebase/web/state/server/environment-protocol-client";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

const environmentId = "00000000-0000-4000-8000-000000000001";

describe("browser Environment protocol client", () => {
  it("discovers, negotiates, and snapshots one Environment", async () => {
    await withListener(async (origin, events) => {
      const connection = await connectCurrentEnvironment(origin, "0.0.0");
      expect(connection.negotiated).toMatchObject({
        _tag: "HelloAccepted",
        environmentId,
      });

      await expect(
        fetchEnvironmentSnapshot(origin, connection.discovery),
      ).resolves.toEqual({ environmentId, sequence: 0 });

      const changed = connection.waitForSequence(1);
      events.publishChanged();
      await expect(changed).resolves.toBe(1);
      connection.close();
      await expect(connection.waitForSequence(2)).rejects.toEqual(
        new EnvironmentResponseError({ responseTag: "WebSocket" }),
      );
    });
  });

  it("fetches a fresh snapshot after reconnecting across a sequence gap", async () => {
    await withListener(async (origin, events) => {
      const initial = await connectCurrentEnvironment(origin, "0.0.0");
      initial.close();
      events.publishChanged();
      events.publishChanged();

      const recovered = await connectCurrentEnvironment(origin, "0.0.0", {
        lastObservedSequence: 0,
      });
      events.publishChanged();
      await expect(recovered.waitForSequence(3)).resolves.toBe(3);
      expect(recovered.currentSequence()).toBe(3);

      const resumed = recovered.waitForSequence(4);
      events.publishChanged();
      await expect(resumed).resolves.toBe(4);
      recovered.close();
    });
  });

  it("exposes a tagged protocol rejection", async () => {
    await withListener(async (origin) => {
      const discovery = await fetchEnvironmentDiscovery(origin);
      const incompatibleHello = {
        ...createCurrentEnvironmentHello("0.0.0"),
        protocol: { major: 2, minor: 0, minimumSupportedMinor: 0 },
      };

      await expect(
        connectEnvironment(origin, discovery, incompatibleHello),
      ).rejects.toEqual(
        new EnvironmentHelloRejected({
          failure: {
            _tag: "ProtocolMajorMismatch",
            clientMajor: 2,
            requiredUpdate: "server",
            serverMajor: 1,
          },
        }),
      );
    });
  });

  it("uses the server baseline when resnapshot was not negotiated", async () => {
    await withListener(async (origin, events) => {
      const discovery = await fetchEnvironmentDiscovery(origin);
      const hello = {
        ...createCurrentEnvironmentHello("0.0.0", 12),
        capabilities: [
          {
            introducedInMinor: 0,
            name: "environment-events",
            version: 1,
          },
        ],
        protocol: { major: 1, minor: 0, minimumSupportedMinor: 0 },
      };
      const connection = await connectEnvironment(origin, discovery, hello);
      expect(connection.currentSequence()).toBe(0);

      const changed = connection.waitForSequence(1);
      events.publishChanged();
      await expect(changed).resolves.toBe(1);
      connection.close();
    });
  });
});

function withListener(
  run: (origin: string, events: EnvironmentEventPublisher) => Promise<void>,
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const events = createEnvironmentEventPublisher();
        const listener = yield* acquireEnvironmentListener({
          environmentId,
          events,
          productVersion: "0.0.0",
        });
        listener.readiness.value = true;
        yield* Effect.promise(() => run(listener.origin, events));
      }),
    ),
  );
}
