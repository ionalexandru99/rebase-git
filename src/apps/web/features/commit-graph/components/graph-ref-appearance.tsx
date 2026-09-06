import type { RepositoryRefs } from "@rebase/contracts";
import { createContext, type ReactNode, useContext, useMemo } from "react";

const Appearance = createContext<{
  readonly colors: ReadonlyMap<string, string>;
  readonly providers: ReadonlyMap<
    string,
    NonNullable<RepositoryRefs["remoteProviders"]>[number]["provider"]
  >;
}>({ colors: new Map(), providers: new Map() });

export function GraphRefAppearance({
  colors,
  remoteProviders,
  children,
}: {
  readonly colors: ReadonlyMap<string, string>;
  readonly remoteProviders: RepositoryRefs["remoteProviders"];
  readonly children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      colors,
      providers: new Map(
        remoteProviders?.map((item) => [item.remote, item.provider]),
      ),
    }),
    [colors, remoteProviders],
  );
  return <Appearance value={value}>{children}</Appearance>;
}

export function useGraphRefAppearance() {
  return useContext(Appearance);
}
