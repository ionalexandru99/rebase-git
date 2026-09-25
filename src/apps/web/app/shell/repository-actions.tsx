import type { ReactNode } from "react";
import { BranchManagement } from "#web/features/branch-management/index";
import { OperationRecovery } from "#web/features/operation-recovery/index";
import { RepositoryPush } from "#web/features/repository-push/index";
import type { RepositoryRefsController } from "#web/features/repository-refs/index";
import {
  type RepositoryScope,
  RepositoryScopeProvider,
} from "#web/features/repository-scope/index";

export function RepositoryActions({
  scope,
  refs,
  children,
}: {
  readonly scope: RepositoryScope | undefined;
  readonly refs: RepositoryRefsController;
  readonly children: ReactNode;
}) {
  return (
    <RepositoryScopeProvider scope={scope}>
      <OperationRecovery.Provider>
        <RepositoryPush.Provider>
          <BranchManagement.Provider refs={refs}>
            {children}
          </BranchManagement.Provider>
        </RepositoryPush.Provider>
      </OperationRecovery.Provider>
    </RepositoryScopeProvider>
  );
}
