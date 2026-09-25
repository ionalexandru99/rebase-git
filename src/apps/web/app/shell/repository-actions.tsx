import type { ReactNode } from "react";
import { BranchManagement } from "#web/features/branch-management/index";
import { OperationRecovery } from "#web/features/operation-recovery/index";
import { RepositoryPush } from "#web/features/repository-push/index";
import {
  type RepositoryScope,
  RepositoryScopeProvider,
} from "#web/features/repository-scope/index";

export function RepositoryActions({
  scope,
  children,
}: {
  readonly scope: RepositoryScope | undefined;
  readonly children: ReactNode;
}) {
  return (
    <RepositoryScopeProvider scope={scope}>
      <OperationRecovery.Provider>
        <RepositoryPush.Provider>
          <BranchManagement.Provider>{children}</BranchManagement.Provider>
        </RepositoryPush.Provider>
      </OperationRecovery.Provider>
    </RepositoryScopeProvider>
  );
}
