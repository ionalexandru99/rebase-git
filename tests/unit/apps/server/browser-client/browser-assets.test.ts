import { resolve } from "node:path";
import {
  browserAssetPath,
  resolveBrowserAsset,
} from "@rebase/server/features/browser-client/browser-assets";
import { describe, expect, it } from "vite-plus/test";

const assetsRoot = resolve("browser-assets");

describe("browser asset routing", () => {
  it.each(["/", "/pair", "/pair/"])(
    "routes %s to the browser entry point",
    (pathname) => {
      expect(browserAssetPath(pathname)).toBe("index.html");
    },
  );

  it("resolves fingerprinted assets within the asset root", () => {
    expect(resolveBrowserAsset("/assets/application.js", assetsRoot)).toEqual({
      cache: true,
      extension: ".js",
      path: resolve(assetsRoot, "assets/application.js"),
    });
  });

  it.each([
    "/assets/",
    "/assets/%2e%2e/%2e%2e/etc/passwd",
    "/assets/%2F..%2F..%2Fetc/passwd",
    "/unknown",
  ])("rejects unsupported asset path %s", (pathname) => {
    expect(resolveBrowserAsset(pathname, assetsRoot)).toBeUndefined();
  });
});
