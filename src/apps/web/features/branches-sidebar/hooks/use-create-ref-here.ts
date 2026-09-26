import { useMemo, useState } from "react";
import type { GraphCommandDefinition } from "#web/features/commit-commands/graph-command";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";

export interface RefCreateRequest {
  readonly kind: "branch" | "tag";
  readonly oid: string;
  readonly sequence: number;
}

export function useCreateRefHere() {
  const writable = useRepositoryScope()?.writable ?? false;
  const [request, setRequest] = useState<RefCreateRequest>();
  const commands = useMemo(() => {
    if (!writable) return [];
    const requestCreate = (kind: RefCreateRequest["kind"], oid: string) =>
      setRequest((current) => ({
        kind,
        oid,
        sequence: (current?.sequence ?? 0) + 1,
      }));
    return [
      createRefHereCommand(
        "branch.createHere",
        10,
        "Create branch here…",
        (oid) => requestCreate("branch", oid),
      ),
      createRefHereCommand("tag.createHere", 11, "Create tag here…", (oid) =>
        requestCreate("tag", oid),
      ),
    ];
  }, [writable]);
  return { request, commands };
}

function createRefHereCommand(
  id: string,
  order: number,
  label: string,
  requestCreate: (oid: string) => void,
): GraphCommandDefinition {
  return {
    id,
    order,
    resolve: (context) => ({
      label,
      enabled: context.connected && context.writable,
      execute: async () => {
        requestCreate(context.invokingOid);
        return { _tag: "Executed" };
      },
    }),
  };
}
