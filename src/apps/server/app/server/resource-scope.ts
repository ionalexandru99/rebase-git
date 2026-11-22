type Close = () => unknown;

export interface ResourceScope {
  readonly use: <Resource extends { readonly close: Close }>(
    resource: Resource,
  ) => Resource;
  readonly defer: (close: Close) => void;
  readonly close: () => Promise<void>;
}

export function createResourceScope(): ResourceScope {
  const closers: Close[] = [];
  return {
    use: (resource) => {
      closers.push(() => resource.close());
      return resource;
    },
    defer: (close) => {
      closers.push(close);
    },
    close: async () => {
      let failure: { readonly error: unknown } | undefined;
      for (let close = closers.pop(); close; close = closers.pop()) {
        try {
          await close();
        } catch (error) {
          failure ??= { error };
        }
      }
      if (failure !== undefined) throw failure.error;
    },
  };
}

export async function acquireScoped<Value extends object>(
  acquire: (scope: ResourceScope) => Promise<Value>,
): Promise<Value & { readonly close: () => Promise<void> }> {
  const scope = createResourceScope();
  try {
    return { ...(await acquire(scope)), close: scope.close };
  } catch (error) {
    await scope.close().catch(() => undefined);
    throw error;
  }
}
