import { errorMessage } from "@rebase/server/environment-server/error-inspection";
import { EnvironmentStorageError } from "@rebase/server/environment-server/storage/storage-error";
import { Effect, type Semaphore } from "effect";

export function serializedPromise<A>(
  writer: Semaphore.Semaphore,
  message: string,
  operation: () => PromiseLike<A>,
) {
  return writer.withPermit(storagePromise(message, operation));
}

export function serializedSync<A>(
  writer: Semaphore.Semaphore,
  message: string,
  operation: () => A,
) {
  return writer.withPermit(storageSync(message, operation));
}

export function storagePromise<A>(
  message: string,
  operation: () => PromiseLike<A>,
) {
  return Effect.tryPromise({
    try: async () => operation(),
    catch: (cause) => storageError(message, cause),
  });
}

export function storageSync<A>(message: string, operation: () => A) {
  return Effect.try({
    try: operation,
    catch: (cause) => storageError(message, cause),
  });
}

function storageError(message: string, cause: unknown) {
  return new EnvironmentStorageError({
    cause,
    message: `${message}: ${errorMessage(cause)}`,
  });
}
