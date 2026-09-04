export function holdRepositoryHistoryReaderLease(
  connect: (name?: string) => void,
) {
  const locks = globalThis.navigator?.locks;
  if (locks === undefined) {
    connect();
    return () => undefined;
  }
  const name = `rebase-history-reader:${crypto.randomUUID()}`;
  let closed = false;
  let release: (() => void) | undefined;
  void locks
    .request(name, () => {
      if (closed) return;
      return new Promise<void>((resolve) => {
        release = resolve;
        connect(name);
      });
    })
    .catch(() => {
      if (!closed) connect();
    });
  return () => {
    closed = true;
    release?.();
  };
}

export function watchRepositoryHistoryReaderLease(
  name: string | undefined,
  close: () => void,
) {
  const locks = globalThis.navigator?.locks;
  if (name === undefined || locks === undefined) return () => undefined;
  const controller = new AbortController();
  void locks
    .request(name, { signal: controller.signal }, close)
    .catch(() => undefined);
  return () => controller.abort();
}
