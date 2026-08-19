export function isFileSystemError(
  error: unknown,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
