import { type FormEvent, useId, useState } from "react";
import { RepositoryWorktreesApi } from "#contracts/repository-worktrees/repository-worktrees.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
  SettingsField,
  SettingsRow,
} from "#web/components/ui/settings-layout.tsx";
import { worktreeFailureMessages } from "#web/features/worktrees/worktrees.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

export function WorktreeFolderSettings({
  repositoryId,
  path,
  canConfigure,
}: {
  readonly repositoryId: string;
  readonly path: string;
  readonly canConfigure: boolean;
}) {
  const target = { repositoryId, worktreePath: path };
  const query = useEnvironmentQuery(RepositoryWorktreesApi.folder, target, {
    changes: "refs",
  });
  const save = useCommand(RepositoryWorktreesApi.setFolder, { target });
  const [open, setOpen] = useState(false);
  const data = query.data;
  return (
    <SettingsRow
      title="Worktree folder"
      description={
        query.error !== null ? (
          describeFailure(query.error)
        ) : data === undefined ? undefined : (
          <span className="break-all font-mono">{data.folder}</span>
        )
      }
      {...(data === undefined || !canConfigure
        ? {}
        : {
            details: {
              label: "Worktree folder",
              open,
              onOpenChange: (next: boolean) => {
                save.reset();
                setOpen(next);
              },
              content: (
                <FolderForm
                  busy={save.running || !save.canRun}
                  configured={data.configured}
                  error={
                    save.failure === undefined
                      ? undefined
                      : describeFailure(save.failure, worktreeFailureMessages)
                  }
                  folder={data.folder}
                  onSave={async (folder) => {
                    const result = await save.run({ folder });
                    if (result._tag === "Ok") setOpen(false);
                  }}
                />
              ),
            },
          })}
    />
  );
}

function FolderForm({
  folder,
  configured,
  busy,
  error,
  onSave,
}: {
  readonly folder: string;
  readonly configured: boolean;
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly onSave: (folder: string | null) => Promise<void>;
}) {
  const id = useId();
  const [value, setValue] = useState(folder);
  const next = value.trim();
  const changed = next.length > 0 && next !== folder;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (changed && !busy) void onSave(next);
  };
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <SettingsField id={`${id}-folder`} label="Folder">
        <Input
          autoComplete="off"
          id={`${id}-folder`}
          onChange={(event) => setValue(event.target.value)}
          spellCheck={false}
          value={value}
        />
      </SettingsField>
      <div className="flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-meta text-destructive">
          {error}
        </p>
        <div className="flex shrink-0 gap-2">
          {configured ? (
            <Button
              disabled={busy}
              onClick={() => void onSave(null)}
              size="xs"
              type="button"
              variant="outline"
            >
              Use default
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
