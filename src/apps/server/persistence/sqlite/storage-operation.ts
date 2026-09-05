import { Effect, type Semaphore } from "effect";
import { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import { errorMessage } from "#server/error-inspection";

export function serializedPromise<A>(
  writer: Semaphore.Semaphore,
  message: string,
  operation: () => A | PromiseLike<A>,
) {
  return writer.withPermit(storagePromise(message, operation));
}

export function storagePromise<A>(
  message: string,
  operation: () => A | PromiseLike<A>,
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
