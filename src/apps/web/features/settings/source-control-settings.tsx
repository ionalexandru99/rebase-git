import {
  IconBrandAzure,
  IconBrandBitbucket,
  IconBrandGit,
  IconBrandGithub,
  IconBrandGitlab,
  IconGitFork,
  IconRefresh,
  type TablerIcon,
} from "@tabler/icons-react";
import { Fragment, type ReactNode, useState } from "react";
import {
  type BitbucketToken,
  type GitHostKind,
  type GitHostStatus,
  type GitStatus,
  SourceControlApi,
} from "#contracts/source-control/source-control.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { HiddenText } from "#web/components/ui/hidden-text.tsx";
import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "#web/components/ui/settings-layout.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { ServerIdentityRow } from "#web/features/git-identity/git-identity.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { ServerPullStrategyRow } from "#web/features/remote-sync/pull-strategy.tsx";
import { CloneFolderRow } from "#web/features/repository-catalog/clone-folder-row.tsx";
import { BitbucketTokenForm } from "#web/features/settings/bitbucket-token-form.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

interface HostDescriptor {
  readonly label: string;
  readonly icon: TablerIcon;
  readonly color: string;
  readonly install?: ReactNode;
  readonly signIn?: ReactNode;
}

export const hostDescriptors: Record<GitHostKind, HostDescriptor> = {
  github: {
    label: "GitHub",
    icon: IconBrandGithub,
    color: "text-foreground/80",
    install: (
      <>
        Install the GitHub command-line tool (<Code>gh</Code>) via
        https://cli.github.com/ or your package manager (for example{" "}
        <Code>brew install gh</Code>).
      </>
    ),
    signIn: (
      <>
        Sign in with <Code>gh auth login</Code> on the server to show pull
        requests.
      </>
    ),
  },
  gitlab: {
    label: "GitLab",
    icon: IconBrandGitlab,
    color: "text-[#fc6d26]",
    install: (
      <>
        Install the GitLab command-line tool (<Code>glab</Code>) via
        https://gitlab.com/gitlab-org/cli or your package manager (for example{" "}
        <Code>brew install glab</Code>).
      </>
    ),
    signIn: (
      <>
        Sign in with <Code>glab auth login</Code> on the server to show merge
        requests.
      </>
    ),
  },
  "azure-devops": {
    label: "Azure DevOps",
    icon: IconBrandAzure,
    color: "text-[#3b8eea]",
    install: (
      <>
        Install the Azure command-line tool (<Code>az</Code>) via
        https://aka.ms/installazurecli or your package manager (for example{" "}
        <Code>brew install azure-cli</Code>).
      </>
    ),
    signIn: (
      <>
        Sign in with <Code>az login --allow-no-subscriptions</Code> on the
        server to show pull requests.
      </>
    ),
  },
  bitbucket: {
    label: "Bitbucket",
    icon: IconBrandBitbucket,
    color: "text-[#2684ff]",
  },
  forgejo: {
    label: "Forgejo / Gitea",
    icon: IconGitFork,
    color: "text-[#ff6600]",
    install: (
      <>
        Install the Gitea command-line tool (<Code>tea</Code>) 0.12 or newer via
        https://gitea.com/gitea/tea or your package manager (for example{" "}
        <Code>brew install tea</Code>).
      </>
    ),
    signIn: (
      <>
        Sign in with <Code>tea login add</Code> on the server to show pull
        requests.
      </>
    ),
  },
};

export function SourceControlSettings() {
  const discovery = useEnvironmentQuery(SourceControlApi.discover, undefined, {
    changes: "none",
    refetchOnWindowFocus: "always",
  });
  const rescan = (
    <Button
      aria-label="Rescan this server"
      disabled={discovery.isFetching}
      onClick={() => void discovery.refetch()}
      size="icon-xs"
      variant="ghost"
    >
      <IconRefresh aria-hidden="true" className="size-4" />
    </Button>
  );

  return (
    <SettingsPage title="Source control">
      <SettingsSection action={rescan} title="Version Control">
        {discovery.data === undefined ? (
          <Checking failed={discovery.isError} />
        ) : (
          <GitRow git={discovery.data.git} />
        )}
        <ServerPullStrategyRow />
      </SettingsSection>
      <SettingsSection title="Defaults">
        <CloneFolderRow />
      </SettingsSection>
      <SettingsSection title="Source Control Providers">
        {discovery.data === undefined ? (
          <Checking failed={discovery.isError} />
        ) : (
          discovery.data.hosts.map((host) => (
            <HostRow host={host} key={host.kind} />
          ))
        )}
      </SettingsSection>
    </SettingsPage>
  );
}

const gitIcon = (
  <IconBrandGit aria-hidden="true" className="size-4.5 text-[#f05032]" />
);

function GitRow({ git }: { readonly git: GitStatus }) {
  return git._tag === "Available" ? (
    <ServerIdentityRow icon={gitIcon} version={git.version} />
  ) : (
    <SettingsRow
      description="Not available on this server: Install Git from https://git-scm.com/downloads or with your package manager."
      icon={gitIcon}
      status="attention"
      title="Git"
    />
  );
}

function HostRow({ host }: { readonly host: GitHostStatus }) {
  const descriptor = hostDescriptors[host.kind];
  const errorToast = useErrorToast();
  const setEnabled = useCommand(SourceControlApi.setHostEnabled);
  const icon = (
    <descriptor.icon
      aria-hidden="true"
      className={`size-4.5 ${descriptor.color}`}
    />
  );
  if (host._tag === "ComingSoon")
    return (
      <SettingsRow
        badge="Coming Soon"
        description={`Support for ${descriptor.label} is coming soon.`}
        dim
        icon={icon}
        title={descriptor.label}
      />
    );
  const signedIn =
    host._tag === "SignedIn" || (host._tag === "Token" && host.saved !== null);
  const enabled = setEnabled.running
    ? (setEnabled.input?.enabled ?? host.enabled)
    : host.enabled;
  const toggle = (
    <Switch
      aria-label={`Use ${descriptor.label}`}
      checked={signedIn && enabled}
      disabled={!signedIn || setEnabled.running}
      onCheckedChange={async (checked) =>
        errorToast.failure(
          "saveSourceControl",
          await setEnabled.run({ kind: host.kind, enabled: checked }),
        )
      }
    />
  );
  if (host._tag === "Token")
    return (
      <TokenRow
        icon={icon}
        label={descriptor.label}
        saved={host.saved}
        toggle={toggle}
      />
    );
  return (
    <SettingsRow
      {...(host._tag === "SignedOut" ? { badge: "Not authenticated" } : {})}
      {...(host._tag === "Missing" ? {} : { value: host.version })}
      description={
        host._tag === "SignedIn" ? (
          <>
            Authenticated as{" "}
            {host.accounts.map(({ host: server, account }, index) => (
              <Fragment key={`${account}@${server}`}>
                {index === 0 ? null : ", "}
                <HiddenText
                  hideLabel={`Hide account ${account} on ${server}`}
                  showLabel={`Show account on ${server}`}
                  value={account}
                />{" "}
                on {server}
              </Fragment>
            ))}
          </>
        ) : host._tag === "SignedOut" ? (
          descriptor.signIn
        ) : (
          <>Not available on this server: {descriptor.install}</>
        )
      }
      icon={icon}
      status={signedIn ? "ready" : "attention"}
      title={descriptor.label}
    >
      {toggle}
    </SettingsRow>
  );
}

function TokenRow({
  icon,
  label,
  saved,
  toggle,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly saved: BitbucketToken | null;
  readonly toggle: ReactNode;
}) {
  const [open, setOpen] = useState(saved === null);
  const missingScopes =
    saved?._tag === "ApiToken" && saved.missingScopes.length > 0;
  return (
    <SettingsRow
      {...(saved === null
        ? { badge: "Not authenticated" }
        : missingScopes
          ? { badge: "Missing scopes" }
          : {})}
      description={
        saved === null ? (
          "Save an access token or an API token to show pull requests."
        ) : saved._tag === "AccessToken" ? (
          "Authenticated with an access token"
        ) : (
          <>
            Authenticated as{" "}
            <HiddenText
              hideLabel={`Hide account ${saved.account} on bitbucket.org`}
              showLabel="Show account on bitbucket.org"
              value={saved.account}
            />
          </>
        )
      }
      details={{
        label: `${label} token`,
        open,
        onOpenChange: setOpen,
        content: (
          <BitbucketTokenForm onSaved={() => setOpen(false)} saved={saved} />
        ),
      }}
      icon={icon}
      status={saved === null || missingScopes ? "attention" : "ready"}
      title={label}
    >
      {toggle}
    </SettingsRow>
  );
}

function Checking({ failed }: { readonly failed: boolean }) {
  return (
    <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
      {failed ? "Could not scan this server." : "Scanning this server…"}
    </p>
  );
}

function Code({ children }: { readonly children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-px text-[.625rem]">
      {children}
    </code>
  );
}
