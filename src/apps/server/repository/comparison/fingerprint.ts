import { createHash } from "node:crypto";

export function fingerprint(...values: readonly (string | Buffer)[]) {
  const hash = createHash("sha256");
  for (const value of values) {
    hash.update(value);
    hash.update("\0");
  }
  return hash.digest("hex");
}
