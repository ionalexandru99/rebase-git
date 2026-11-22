import {
  GitSigningApi,
  type Signing,
  type SigningChoice,
  type SigningFormat,
  sameSigningKey,
} from "#contracts/git-signing/git-signing.contract.ts";
import { SettingsRow } from "#web/components/ui/settings-layout.tsx";
import { SettingsSelect } from "#web/components/ui/settings-select.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useSetting } from "#web/features/settings/setting-rows.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";

const title = "Sign commits";
const formatNames: Readonly<Record<SigningFormat, string>> = {
  openpgp: "GPG",
  ssh: "SSH",
  x509: "X.509",
};

type SigningOption = {
  readonly label: string;
  readonly value: string;
  readonly choice: SigningChoice | null;
};

export function ServerSigningRow() {
  const signing = useSetting(GitSigningApi.read, undefined, GitSigningApi.save);
  const errorToast = useErrorToast();
  const data = signing.data;
  return (
    <SettingsRow description={signing.error} title={title}>
      {data === undefined ? null : (
        <SigningSelect
          configured={data}
          disabled={signing.busy}
          onChoose={async (choice) => {
            if (choice !== null)
              errorToast.failure("saveSigning", await signing.save(choice));
          }}
          value={signing.pending === undefined ? data : signing.pending.value}
        />
      )}
    </SettingsRow>
  );
}

export function RepositorySigningRow({
  repositoryId,
}: {
  readonly repositoryId: string;
}) {
  const signing = useSetting(
    GitSigningApi.readRepository,
    { repositoryId },
    GitSigningApi.saveRepository,
  );
  const errorToast = useErrorToast();
  const data = signing.data;
  return (
    <SettingsRow description={signing.error} title={title}>
      {data === undefined ? null : (
        <SigningSelect
          configured={data.local ?? data.inherited}
          disabled={signing.busy}
          inherited={data.inherited}
          onChoose={async (choice) =>
            errorToast.failure("saveSigning", await signing.save(choice))
          }
          value={
            signing.pending === undefined ? data.local : signing.pending.value
          }
        />
      )}
    </SettingsRow>
  );
}

function SigningSelect({
  configured,
  inherited,
  value,
  disabled,
  onChoose,
}: {
  readonly configured: Signing;
  readonly inherited?: Signing;
  readonly value: SigningChoice | null;
  readonly disabled: boolean;
  readonly onChoose: (choice: SigningChoice | null) => void;
}) {
  const keys = useEnvironmentQuery(GitSigningApi.keys, undefined, {
    changes: "none",
  });
  const listed = keys.data ?? [];
  const known =
    configured._tag === "Key" &&
    !listed.some((key) => sameSigningKey(key, configured))
      ? [configured, ...listed]
      : listed;
  const options: readonly SigningOption[] = [
    ...(inherited === undefined
      ? []
      : [
          {
            label: `Default (${describe(inherited)})`,
            value: "default",
            choice: null,
          },
        ]),
    { label: "Off", value: "off", choice: { _tag: "Off" } },
    ...known.map((key) => ({
      label: describe({ _tag: "Key", ...key }),
      value: `${key.format}:${key.key}`,
      choice: { _tag: "Key" as const, format: key.format, key: key.key },
    })),
  ];
  return (
    <SettingsSelect
      disabled={disabled}
      label={title}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option !== undefined) onChoose(option.choice);
      }}
      options={options}
      value={selected(options, value)}
    />
  );
}

function selected(
  options: readonly SigningOption[],
  value: SigningChoice | null,
) {
  if (value === null) return "default";
  if (value._tag === "Off") return "off";
  return (
    options.find(
      ({ choice }) => choice?._tag === "Key" && sameSigningKey(choice, value),
    )?.value ?? "off"
  );
}

function describe(signing: Signing) {
  return signing._tag === "Off"
    ? "Off"
    : `${formatNames[signing.format]} · ${signing.label}`;
}
