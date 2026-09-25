import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { CommandDefinition } from "#web/platform/command-contributions/command-contributions.contract";

export function createCommandSlot<Context>() {
  const Contributions = createContext<readonly CommandDefinition<Context>[]>(
    [],
  );

  function Contribute({
    commands,
    children,
  }: {
    readonly commands: readonly CommandDefinition<Context>[];
    readonly children: ReactNode;
  }) {
    const inherited = useContext(Contributions);
    const contributions = useMemo(
      () => (commands.length === 0 ? inherited : [...inherited, ...commands]),
      [inherited, commands],
    );
    return (
      <Contributions.Provider value={contributions}>
        {children}
      </Contributions.Provider>
    );
  }

  return {
    Contribute,
    useContributions: () => useContext(Contributions),
  };
}
