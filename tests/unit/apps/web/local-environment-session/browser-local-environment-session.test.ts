import { describe, expect, it } from "vite-plus/test";
import { resolveLocalEnvironmentBootstrap } from "#web/features/local-environment-session/browser-local-environment-session";

describe("browser local Environment bootstrap", () => {
  it("uses the desktop host bootstrap for a packaged renderer", () => {
    const bootstrap = {
      environmentOrigin: "http://127.0.0.1:43123",
      pairingMaterial: "123-456",
    };

    expect(
      resolveLocalEnvironmentBootstrap(
        { hash: "", origin: "null", pathname: "/index.html" },
        bootstrap,
      ),
    ).toEqual(bootstrap);
  });

  it("reads browser pairing material from the URL", () => {
    expect(
      resolveLocalEnvironmentBootstrap(
        {
          hash: "#654-321",
          origin: "http://127.0.0.1:43123",
          pathname: "/pair",
        },
        undefined,
      ),
    ).toEqual({
      environmentOrigin: "http://127.0.0.1:43123",
      pairingMaterial: "654-321",
    });
  });
});
