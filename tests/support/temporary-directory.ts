import { rm } from "node:fs/promises";

export function removeTemporaryDirectory(path: string) {
  return rm(path, {
    force: true,
    maxRetries: 10,
    recursive: true,
    retryDelay: 100,
  });
}
