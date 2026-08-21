import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const serverPackage = require("@rebase/server/package.json") as {
  readonly version: string;
};

export const productVersion = serverPackage.version;
