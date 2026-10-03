import { IconUser } from "@tabler/icons-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import {
  type GitIdentity,
  GitIdentityApi,
} from "#contracts/git-identity/git-identity.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { HiddenText } from "#web/components/ui/hidden-text.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
  SettingsField,
  SettingsRow,
} from "#web/components/ui/settings-layout.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

export function ServerIdentityRow({
  icon,
  version,
}: {
  readonly icon: ReactNode;
  readonly version: string;
}) {
  const identity = useEnvironmentQuery(GitIdentityApi.read, undefined, {
    changes: "refs",
  });
  const save = useCommand(GitIdentityApi.save, {
    answers: (value) => [answer(GitIdentityApi.read, undefined, value)],
  });
  const saved = identity.data;
  const missing =
    saved !== undefined &&
    (saved.name === undefined || saved.email === undefined);
  const [open, setOpen] = useState<boolean>();
  return (
    <SettingsRow
      {...(missing ? { badge: "Identity missing" } : {})}
      description={
        identity.error !== null ? (
          `Available · ${describeFailure(identity.error)}`
        ) : saved === undefined || missing ? (
          `Available${missing ? " · Add your name and email to commit." : ""}`
        ) : (
          <>
            Available · Committing as <IdentityText identity={saved} />
          </>
        )
      }
      {...(saved === undefined
        ? {}
        : {
            details: {
              label: "Git identity",
              open: open ?? missing,
              onOpenChange: (next: boolean) => {
                save.reset();
                setOpen(next);
              },
              content: (
                <IdentityForm
                  busy={save.running || !save.canRun}
                  error={
                    save.failure === undefined
                      ? undefined
                      : describeFailure(save.failure)
                  }
                  onSave={async (next) => {
                    const result = await save.run(next);
                    if (result._tag === "Ok") setOpen(false);
                  }}
                  saved={saved}
                />
              ),
            },
          })}
      icon={icon}
      status={missing ? "attention" : "ready"}
      title="Git"
      value={version}
    />
  );
}

export function RepositoryIdentityRow({
  repositoryId,
}: {
  readonly repositoryId: string;
}) {
  const identity = useEnvironmentQuery(
    GitIdentityApi.readRepository,
    { repositoryId },
    { changes: "refs" },
  );
  const save = useCommand(GitIdentityApi.saveRepository, {
    answers: (value) => [
      answer(GitIdentityApi.readRepository, { repositoryId }, value),
    ],
  });
  const [open, setOpen] = useState(false);
  const data = identity.data;
  const overridden =
    data !== undefined &&
    (data.local.name !== undefined || data.local.email !== undefined);
  const effective: GitIdentity | undefined =
    data === undefined ? undefined : { ...data.inherited, ...data.local };
  return (
    <SettingsRow
      description={
        identity.error !== null ? (
          describeFailure(identity.error)
        ) : effective === undefined ? undefined : effective.name ===
            undefined || effective.email === undefined ? (
          "Add your name and email to commit."
        ) : (
          <>
            <IdentityText identity={effective} />
            {overridden ? " · set for this repository" : null}
          </>
        )
      }
      {...(data === undefined
        ? {}
        : {
            details: {
              label: "Repository identity",
              open,
              onOpenChange: (next: boolean) => {
                save.reset();
                setOpen(next);
              },
              content: (
                <IdentityForm
                  busy={save.running || !save.canRun}
                  error={
                    save.failure === undefined
                      ? undefined
                      : describeFailure(save.failure)
                  }
                  inherited={data.inherited}
                  onSave={async (next) => {
                    const result = await save.run({
                      repositoryId,
                      identity: next,
                    });
                    if (result._tag === "Ok") setOpen(false);
                  }}
                  saved={data.local}
                />
              ),
            },
          })}
      icon={
        <IconUser
          aria-hidden="true"
          className="size-4.5 text-muted-foreground"
        />
      }
      title="Identity"
    />
  );
}

function IdentityForm({
  saved,
  inherited,
  busy,
  error,
  onSave,
}: {
  readonly saved: GitIdentity;
  readonly inherited?: GitIdentity;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onSave: (identity: GitIdentity) => Promise<void>;
}) {
  const id = useId();
  const [name, setName] = useState(saved.name ?? "");
  const [email, setEmail] = useState(saved.email ?? "");
  const next = identityOf(name, email);
  const changed = next.name !== saved.name || next.email !== saved.email;
  const overridden =
    inherited !== undefined &&
    (saved.name !== undefined || saved.email !== undefined);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (changed && !busy) void onSave(next);
  };
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <SettingsField id={`${id}-name`} label="Name">
        <Input
          autoComplete="name"
          id={`${id}-name`}
          maxLength={256}
          onChange={(event) => setName(event.target.value)}
          placeholder={inherited?.name ?? "Your name"}
          value={name}
        />
      </SettingsField>
      <SettingsField id={`${id}-email`} label="Email">
        <Input
          autoComplete="email"
          id={`${id}-email`}
          inputMode="email"
          maxLength={256}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={inherited?.email ?? "you@example.com"}
          value={email}
        />
      </SettingsField>
      <div className="flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs text-destructive">
          {error}
        </p>
        <div className="flex shrink-0 gap-2">
          {overridden ? (
            <Button
              disabled={busy}
              onClick={() => void onSave({})}
              size="xs"
              type="button"
              variant="outline"
            >
              Remove override
            </Button>
          ) : null}
          <Button disabled={!changed || busy} size="xs" type="submit">
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

function IdentityText({ identity }: { readonly identity: GitIdentity }) {
  const value = [
    identity.name,
    identity.email === undefined ? undefined : `<${identity.email}>`,
  ]
    .filter((part) => part !== undefined)
    .join(" ");
  return (
    <HiddenText
      hideLabel={`Hide identity ${value}`}
      showLabel="Show identity"
      value={value}
    />
  );
}

function identityOf(name: string, email: string): GitIdentity {
  const trimmedName = name.trim();
  const trimmedEmail = email.trim();
  return {
    ...(trimmedName === "" ? {} : { name: trimmedName }),
    ...(trimmedEmail === "" ? {} : { email: trimmedEmail }),
  };
}
