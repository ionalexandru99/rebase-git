import { createRequire } from "node:module";

declare const REBASE_PRODUCT_VERSION: string;

export const productVersion =
  typeof REBASE_PRODUCT_VERSION === "string"
    ? REBASE_PRODUCT_VERSION
    : readWorkspaceProductVersion();

function readWorkspaceProductVersion() {
  const require = createRequire(import.meta.url);
  const packageMetadata = require("@rebase/server/package.json") as {
    readonly version: string;
  };
  return packageMetadata.version;
}
