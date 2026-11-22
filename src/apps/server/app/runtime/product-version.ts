import { readFileSync } from "node:fs";

declare const REBASE_PRODUCT_VERSION: string;

export function productVersion() {
  if (typeof REBASE_PRODUCT_VERSION === "string") return REBASE_PRODUCT_VERSION;
  const packageMetadata = JSON.parse(
    readFileSync(
      new URL("../../../../../package.json", import.meta.url),
      "utf8",
    ),
  ) as { readonly version: string };
  return packageMetadata.version;
}
