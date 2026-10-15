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
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

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
  const signing = useEnvironmentQuery(GitSigningApi.read, undefined, {
    changes: "refs",
  });
  const save = useCommand(GitSigningApi.save, {
    answers: (value) => [answer(GitSigningApi.read, undefined, value)],
  });
  const errorToast = useErrorToast();
  const data = signing.data;
  return (
    <SettingsRow
      title={title}
      {...(signing.error === null
        ? {}
        : { description: describeFailure(signing.error) })}
    >
      {data === undefined ? null : (
        <SigningSelect
          configured={data}
          disabled={!save.canRun || save.running}
          onChoose={async (choice) => {
            if (choice !== null)
              errorToast.failure("saveSigning", await save.run(choice));
          }}
          value={save.running && save.input !== undefined ? save.input : data}
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
  const signing = useEnvironmentQuery(
    GitSigningApi.readRepository,
    { repositoryId },
    { changes: "refs" },
  );
  const save = useCommand(GitSigningApi.saveRepository, {
    answers: (value) => [
      answer(GitSigningApi.readRepository, { repositoryId }, value),
    ],
  });
  const errorToast = useErrorToast();
  const data = signing.data;
  return (
    <SettingsRow
      title={title}
      {...(signing.error === null
        ? {}
        : { description: describeFailure(signing.error) })}
    >
      {data === undefined ? null : (
        <SigningSelect
          configured={data.local ?? data.inherited}
          disabled={!save.canRun || save.running}
          inherited={data.inherited}
          onChoose={async (choice) =>
            errorToast.failure(
              "saveSigning",
              await save.run({ repositoryId, signing: choice }),
            )
          }
          value={
            save.running && save.input !== undefined
              ? save.input.signing
              : data.local
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
