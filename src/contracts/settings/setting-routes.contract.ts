import { z } from "zod";
import {
  type EnvironmentRoute,
  repositoryCommand,
  repositoryQuery,
  route,
} from "#contracts/environment-connection/environment-route.contract.ts";
import type { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import { RepositoryId } from "#contracts/git/git-values.contract.ts";

export const SettingFailed = z.object({
  _tag: z.literal("SettingFailed"),
  detail: z.string().max(2_048),
});
export type SettingFailed = z.infer<typeof SettingFailed>;

const RepositoryTarget = z.object({ repositoryId: RepositoryId });

type Scoped<Input, Value, Failure> = EnvironmentRoute<
  string,
  z.ZodType<Input>,
  z.ZodType<Value>,
  z.ZodType<Failure>
>;

export interface SettingApi<Value, Choice, Repository> {
  readonly read: Scoped<void, Value, SettingFailed>;
  readonly save: Scoped<{ readonly value: Choice }, Value, SettingFailed>;
  readonly readRepository: Scoped<
    { readonly repositoryId: string },
    Repository,
    RepositoryRejected
  >;
  readonly saveRepository: Scoped<
    { readonly repositoryId: string; readonly value: Choice | null },
    Repository,
    RepositoryRejected
  >;
}

export function settingRoutes<
  const Name extends string,
  Value extends z.ZodType,
  Choice extends z.ZodType,
  Repository extends z.ZodType,
>(
  name: Name,
  {
    value,
    choice,
    repository,
  }: {
    readonly value: Value;
    readonly choice: Choice;
    readonly repository: Repository;
  },
) {
  return {
    read: route(`${name}/read`, { success: value, failure: SettingFailed }),
    save: route(`${name}/save`, {
      request: z.object({ value: choice }),
      success: value,
      failure: SettingFailed,
    }),
    readRepository: repositoryQuery(`${name}/read-repository`, {
      request: RepositoryTarget,
      success: repository,
    }),
    saveRepository: repositoryCommand(`${name}/save-repository`, {
      request: RepositoryTarget.extend({ value: choice.nullable() }),
      success: repository,
    }),
  };
}
