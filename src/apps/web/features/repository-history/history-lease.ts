export function holdLease(prefix: string) {
  const locks = globalThis.navigator?.locks;
  if (locks === undefined) return Promise.resolve(undefined);
  const name = `${prefix}:${crypto.randomUUID()}`;
  return new Promise<string | undefined>((resolve) => {
    locks
      .request(name, () => {
        resolve(name);
        return new Promise<never>(() => {});
      })
      .catch(() => resolve(undefined));
  });
}

export function watchLease(
  name: string,
  released: () => void,
  signal?: AbortSignal,
) {
  void globalThis.navigator?.locks
    ?.request(name, signal === undefined ? {} : { signal }, released)
    .catch(() => undefined);
}
