import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { RepositoryCatalogResponseError } from "@rebase/web/features/repository-catalog";
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { createRepositoryCatalogController } from "#web/features/repository-catalog/repository-catalog-controller";
import {
  type RepositoryCatalogGateway,
  RepositoryCatalogUnavailable,
} from "#web/features/repository-catalog/repository-catalog-controller.contract";

const runtime = ManagedRuntime.make(Layer.empty);

describe("repository catalog controller", () => {
  it("cancels a connection's read and queued mutations without publishing a late response", async () => {
    const started = Promise.withResolvers<AbortSignal>();
    const response = Promise.withResolvers<readonly RepositoryCatalogEntry[]>();
    const gateway = createGateway({ remembered: repository("alpha") });
    gateway.list.mockReturnValueOnce(
      Effect.tryPromise({
        try: (signal) => {
          started.resolve(signal);
          return response.promise;
        },
        catch: () => new RepositoryCatalogResponseError(),
      }),
    );
    const catalog = createRepositoryCatalogController(gateway, runtime);
    const connection = await connect(catalog);
    const listener = vi.fn();
    catalog.controller.subscribe(listener);
    const read = catalog.controller.refresh().catch((error: unknown) => error);
    const signal = await started.promise;
    const queued = catalog.controller
      .remember("/code/alpha")
      .catch((error: unknown) => error);

    await connection.close();
    expect(signal.aborted).toBe(true);
    expect(await read).toBeInstanceOf(Error);
    expect(await queued).toBeInstanceOf(Error);
    expect(gateway.remember).not.toHaveBeenCalled();
    const stoppedSnapshot = catalog.controller.getSnapshot();
    listener.mockClear();
    response.resolve([repository("alpha")]);
    await response.promise;
    expect(catalog.controller.getSnapshot()).toBe(stoppedSnapshot);
    expect(listener).not.toHaveBeenCalled();

    const reconnected = await connect(catalog);
    await catalog.controller.refresh();
    expect(catalog.controller.getSnapshot()).toEqual({
      repositories: [],
      status: "ready",
    });
    await reconnected.close();
  });

  it("keeps a stable snapshot and refreshes once connected", async () => {
    const repositories = [repository("bravo"), repository("alpha")];
    const gateway = createGateway({ list: repositories });
    const catalog = createRepositoryCatalogController(gateway, runtime);
    const listener = vi.fn();
    catalog.controller.subscribe(listener);
    const idle = catalog.controller.getSnapshot();

    const connection = await connect(catalog);
    await catalog.controller.refresh();

    expect(gateway.list).toHaveBeenCalledOnce();
    expect(idle).toEqual({ repositories: [], status: "idle" });
    expect(catalog.controller.getSnapshot()).toEqual({
      repositories: [repository("alpha"), repository("bravo")],
      status: "ready",
    });
    expect(listener).toHaveBeenCalledTimes(2);
    await connection.close();
  });

  it("updates the snapshot after remember, open, and remove", async () => {
    const alpha = repository("alpha");
    const opened = { ...alpha, lastOpenedAt: "2026-08-24T21:00:00.000Z" };
    const gateway = createGateway({
      opened,
      remembered: alpha,
    });
    const catalog = createRepositoryCatalogController(gateway, runtime);
    const connection = await connect(catalog);

    await catalog.controller.remember(alpha.path);
    expect(catalog.controller.getSnapshot().repositories).toEqual([alpha]);
    await catalog.controller.recordOpened(alpha.id);
    expect(catalog.controller.getSnapshot().repositories).toEqual([opened]);
    await catalog.controller.remove(alpha.id);
    expect(catalog.controller.getSnapshot()).toEqual({
      repositories: [],
      status: "ready",
    });
    await connection.close();
  });

  it("rejects operations without a connection without calling the gateway", async () => {
    const gateway = createGateway();
    const catalog = createRepositoryCatalogController(gateway, runtime);

    await expect(catalog.controller.refresh()).rejects.toBeInstanceOf(
      RepositoryCatalogUnavailable,
    );
    expect(catalog.controller.getSnapshot()).toMatchObject({
      error: expect.any(RepositoryCatalogUnavailable),
      status: "error",
    });
    expect(gateway.list).not.toHaveBeenCalled();
  });

  it("retains repositories and publishes a typed error when refresh fails", async () => {
    const alpha = repository("alpha");
    const gateway = createGateway({ list: [alpha] });
    const catalog = createRepositoryCatalogController(gateway, runtime);
    const connection = await connect(catalog);
    await catalog.controller.refresh();
    gateway.list.mockReturnValueOnce(
      Effect.fail(new RepositoryCatalogResponseError()),
    );

    await expect(catalog.controller.refresh()).rejects.toBeInstanceOf(
      RepositoryCatalogResponseError,
    );
    expect(catalog.controller.getSnapshot()).toEqual({
      error: new RepositoryCatalogResponseError(),
      repositories: [alpha],
      status: "error",
    });
    await connection.close();
  });
});

async function connect(
  catalog: ReturnType<typeof createRepositoryCatalogController>,
) {
  const scope = Scope.makeUnsafe();
  await runtime.runPromise(catalog.connect().pipe(Scope.provide(scope)));
  return { close: () => runtime.runPromise(Scope.close(scope, Exit.void)) };
}

function createGateway(
  values: {
    readonly list?: readonly RepositoryCatalogEntry[];
    readonly opened?: RepositoryCatalogEntry;
    readonly remembered?: RepositoryCatalogEntry;
  } = {},
) {
  return {
    list: vi.fn<RepositoryCatalogGateway["list"]>(() =>
      Effect.succeed(values.list ?? []),
    ),
    recordOpened: vi.fn<RepositoryCatalogGateway["recordOpened"]>(() =>
      values.opened === undefined
        ? Effect.die("No opened repository was provided.")
        : Effect.succeed(values.opened),
    ),
    remember: vi.fn<RepositoryCatalogGateway["remember"]>(() =>
      values.remembered === undefined
        ? Effect.die("No remembered repository was provided.")
        : Effect.succeed(values.remembered),
    ),
    remove: vi.fn<RepositoryCatalogGateway["remove"]>(() => Effect.void),
  } satisfies RepositoryCatalogGateway & {
    list: ReturnType<typeof vi.fn<RepositoryCatalogGateway["list"]>>;
  };
}

function repository(name: string): RepositoryCatalogEntry {
  return {
    addedAt: "2026-08-24T20:00:00.000Z",
    id:
      name === "alpha"
        ? "00000000-0000-4000-8000-000000000001"
        : "00000000-0000-4000-8000-000000000002",
    lastOpenedAt: "2026-08-24T20:00:00.000Z",
    name,
    path: `/code/${name}`,
  };
}
