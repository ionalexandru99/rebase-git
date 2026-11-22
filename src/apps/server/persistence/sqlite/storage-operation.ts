import { errorMessage } from "#server/error-inspection.ts";

export function storageError(message: string, cause: unknown) {
  return new Error(`${message}: ${errorMessage(cause)}`, { cause });
}

export async function storageOperation<A>(
  message: string,
  operation: () => A | PromiseLike<A>,
) {
  try {
    return await operation();
  } catch (cause) {
    throw storageError(message, cause);
  }
}

export function storageSync<A>(message: string, operation: () => A) {
  try {
    return operation();
  } catch (cause) {
    throw storageError(message, cause);
  }
}
