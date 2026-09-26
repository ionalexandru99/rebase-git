import { useMemo, useState } from "react";
import { createBranchHereCommand } from "#web/features/branch-management/create-branch-here-command";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";

export interface BranchCreateRequest {
  readonly oid: string;
  readonly sequence: number;
}

export function useCreateBranchHere() {
  const writable = useRepositoryScope()?.writable ?? false;
  const [request, setRequest] = useState<BranchCreateRequest>();
  const commands = useMemo(
    () =>
      writable
        ? [
            createBranchHereCommand((oid) =>
              setRequest((current) => ({
                oid,
                sequence: (current?.sequence ?? 0) + 1,
              })),
            ),
          ]
        : [],
    [writable],
  );
  return { request, commands };
}
