import type { EnvironmentAuthorizationRole } from "@rebase/contracts";

export type AuthorizationRole = EnvironmentAuthorizationRole;

export interface Environment {
  readonly automaticPort: number | null;
  readonly id: string;
}

export interface AuthorizationMetadata {
  readonly createdAt: string;
  readonly id: string;
  readonly label: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
  readonly role: AuthorizationRole;
}
