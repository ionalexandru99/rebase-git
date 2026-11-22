import { homedir } from "node:os";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  GitSigningApi,
  gpgKeyId,
  type RepositorySigning,
  type Signing,
  type SigningChoice,
  type SigningFailed,
  type SigningFormat,
  SigningFormats,
  type SigningKey,
  signingKeyName,
  sshPublicKey,
} from "#contracts/git-signing/git-signing.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type EnvironmentFeature,
  route,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  isGitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import {
  type ConfigScope,
  readScopedConfig,
  type ScopedConfig,
  saveScopedConfig,
  scopedValue,
} from "#server/adapters/local-git/git-config-scopes.ts";
import { listSigningKeys } from "#server/features/git-signing/signing-keys.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const keys = {
  sign: "commit.gpgSign",
  format: "gpg.format",
  key: "user.signingKey",
} as const;
const configKeys = [keys.sign, keys.format, keys.key];
const off: Signing = { _tag: "Off" };

type SigningConfigKey = (typeof configKeys)[number];
type SigningConfig = ScopedConfig<SigningConfigKey>;
type ConfigValue = (key: SigningConfigKey) => string | undefined;

export function gitSigningFeature({
  access,
  events,
  git,
}: {
  readonly access: RepositoryAccess;
  readonly events: EnvironmentEventPublisher;
  readonly git: GitCommandRunner;
}) {
  return {
    routes: [
      route(GitSigningApi.read, () =>
        failingAsSigning(async () =>
          globalSigning(await readScopedConfig(git, homedir(), configKeys)),
        ),
      ),
      route(GitSigningApi.save, (choice) =>
        failingAsSigning(async () => {
          const values = await saveScopedConfig(
            git,
            homedir(),
            "--global",
            configKeys,
            writesFor(choice),
          );
          events.publishChanged();
          return globalSigning(values);
        }),
      ),
      route(GitSigningApi.keys, () => listSigningKeys(git, homedir())),
      route(GitSigningApi.readRepository, async ({ repositoryId }) => {
        const { path } = await access.repository(repositoryId);
        return rejectingGitFailures(async () =>
          repositorySigning(await readScopedConfig(git, path, configKeys)),
        );
      }),
      route(GitSigningApi.saveRepository, async ({ repositoryId, signing }) => {
        const { path } = await access.repository(repositoryId);
        return rejectingGitFailures(async () => {
          const values = await saveScopedConfig(
            git,
            path,
            "--local",
            configKeys,
            writesFor(signing),
          );
          events.publishChanged([repositoryId]);
          return repositorySigning(values);
        });
      }),
    ],
  } satisfies EnvironmentFeature;
}

function globalSigning(values: SigningConfig) {
  return signingOf((key) => scopedValue(values, "--global", key));
}

function repositorySigning(values: SigningConfig): RepositorySigning {
  const value = (scope: ConfigScope) => (key: SigningConfigKey) =>
    scopedValue(values, scope, key);
  const local = value("--local");
  const inherited = value("--global");
  return {
    local: configKeys.some((key) => local(key) !== undefined)
      ? signingOf((key) => local(key) ?? inherited(key))
      : null,
    inherited: signingOf(inherited),
  };
}

function signingOf(value: ConfigValue): Signing {
  if (!/^(?:true|yes|on|1)$/i.test(value(keys.sign) ?? "")) return off;
  const configured = value(keys.format)?.toLowerCase();
  const format =
    SigningFormats.find((candidate) => candidate === configured) ?? "openpgp";
  return { _tag: "Key", ...signingKey(format, value(keys.key) ?? "") };
}

function writesFor(
  choice: SigningChoice | null,
): Partial<Record<SigningConfigKey, string | null>> {
  if (choice === null)
    return { [keys.sign]: null, [keys.format]: null, [keys.key]: null };
  if (choice._tag === "Off") return { [keys.sign]: "false" };
  return {
    [keys.sign]: "true",
    [keys.format]: choice.format,
    [keys.key]: choice.key === "" ? null : choice.key,
  };
}

function signingKey(format: SigningFormat, value: string): SigningKey {
  if (value === "") return { format, key: "", label: "Default key" };
  if (format === "ssh") {
    const literal = sshPublicKey(value);
    return {
      format,
      key: value,
      label:
        literal === undefined
          ? signingKeyName(value)
          : literal.comment || `…${literal.blob.slice(-8)}`,
    };
  }
  const id = gpgKeyId(value);
  return { format, key: value, label: id === undefined ? value : id.slice(-8) };
}

async function failingAsSigning<Value>(run: () => Promise<Value>) {
  try {
    return await run();
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    throw {
      _tag: "SigningFailed",
      detail: error.detail.slice(0, 2_048),
    } satisfies SigningFailed;
  }
}

async function rejectingGitFailures<Value>(run: () => Promise<Value>) {
  try {
    return await run();
  } catch (error) {
    throw isGitFailed(error)
      ? repositoryRejected("GitFailed", error.detail)
      : error;
  }
}
