import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { RepositoryCatalogResponseError } from "@rebase/web/features/repository-catalog";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { createRepositoryCatalogController } from "#web/features/repository-catalog/repository-catalog-controller";
import {
  type RepositoryCatalogGateway,
  RepositoryCatalogUnavailable,
} from "#web/features/repository-catalog/repository-catalog-controller.contract";

describe("repository catalog controller", () => {
  it("keeps a stable snapshot and refreshes with its private credential", async () => {
    const repositories = [repository("bravo"), repository("alpha")];
    const gateway = createGateway({ list: repositories });
    const catalog = createRepositoryCatalogController(gateway);
    const listener = vi.fn();
    catalog.controller.subscribe(listener);
    const idle = catalog.controller.getSnapshot();

    catalog.authorize("private-credential");
    await catalog.controller.refresh();

    expect(gateway.list).toHaveBeenCalledWith("private-credential");
    expect(idle).toEqual({ repositories: [], status: "idle" });
    expect(catalog.controller.getSnapshot()).toEqual({
      repositories: [repository("alpha"), repository("bravo")],
      status: "ready",
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("updates the snapshot after remember, open, and remove", async () => {
    const alpha = repository("alpha");
    const opened = { ...alpha, lastOpenedAt: "2026-08-24T21:00:00.000Z" };
    const gateway = createGateway({
      opened,
      remembered: alpha,
    });
    const catalog = createRepositoryCatalogController(gateway);
    catalog.authorize("private-credential");

    await catalog.controller.remember(alpha.path);
    expect(catalog.controller.getSnapshot().repositories).toEqual([alpha]);
    await catalog.controller.recordOpened(alpha.id);
    expect(catalog.controller.getSnapshot().repositories).toEqual([opened]);
    await catalog.controller.remove(alpha.id);
    expect(catalog.controller.getSnapshot()).toEqual({
      repositories: [],
      status: "ready",
    });
  });

  it("rejects operations before authorization without calling the gateway", async () => {
    const gateway = createGateway();
    const catalog = createRepositoryCatalogController(gateway);

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
    const catalog = createRepositoryCatalogController(gateway);
    catalog.authorize("private-credential");
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
  });
});

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
