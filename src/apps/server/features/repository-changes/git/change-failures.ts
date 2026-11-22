import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";

export async function changeIo<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    throw repositoryRejected(
      "GitFailed",
      error instanceof Error
        ? error.message
        : "The filesystem operation failed.",
    );
  }
}
