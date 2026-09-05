import type { EnvironmentDirectory } from "@rebase/contracts";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { createEnvironmentFilesystemController } from "#web/features/environment-filesystem/environment-filesystem-controller";
import type { EnvironmentFilesystemGateway } from "#web/features/environment-filesystem/environment-filesystem-controller.contract";
import { EnvironmentFilesystemUnavailable } from "#web/features/environment-filesystem/environment-filesystem-controller.contract";

const listing = {
  breadcrumbs: [{ name: "/", path: "/" }],
  entries: [],
  path: "/",
  truncated: false,
} satisfies EnvironmentDirectory;

describe("Environment filesystem controller", () => {
  it("keeps the credential inside the session boundary", async () => {
    const gateway = createGateway();
    const session = createEnvironmentFilesystemController(gateway);

    await expect(session.controller.listDirectory()).rejects.toEqual(
      new EnvironmentFilesystemUnavailable(),
    );

    session.authorize({ type: "bearer", value: "device-credential" });
    await expect(session.controller.listDirectory("/work")).resolves.toEqual(
      listing,
    );
    expect(gateway.listDirectory).toHaveBeenCalledWith(
      { type: "bearer", value: "device-credential" },
      "/work",
    );
  });
});

function createGateway() {
  return {
    listDirectory: vi.fn<EnvironmentFilesystemGateway["listDirectory"]>(() =>
      Effect.succeed(listing),
    ),
  } satisfies EnvironmentFilesystemGateway & {
    listDirectory: ReturnType<
      typeof vi.fn<EnvironmentFilesystemGateway["listDirectory"]>
    >;
  };
}
