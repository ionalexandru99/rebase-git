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
  type GitHostKind,
  type GitHostStatus,
  type GitStatus,
  SourceControlApi,
} from "#contracts/source-control/source-control.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { localEnvironment } from "#web/features/project-navigation/local-environment.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

interface HostDescriptor {
  readonly label: string;
  readonly icon: TablerIcon;
  readonly color: string;
  readonly install?: ReactNode;
  readonly signIn?: ReactNode;
}

const hostDescriptors: Record<GitHostKind, HostDescriptor> = {
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
  },
};

type Dot = "ready" | "attention" | "none";

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
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 pt-10 pb-16 sm:px-8 sm:pt-12">
      <h1 className="text-xl font-semibold tracking-tight">Source control</h1>
      <Section
        action={rescan}
        title={`Version Control · ${localEnvironment.name}`}
      >
        {discovery.data === undefined ? (
          <Checking failed={discovery.isError} />
        ) : (
          <GitRow git={discovery.data.git} />
        )}
      </Section>
      <Section title="Source Control Providers">
        {discovery.data === undefined ? (
          <Checking failed={discovery.isError} />
        ) : (
          discovery.data.hosts.map((host) => (
            <HostRow host={host} key={host.kind} />
          ))
        )}
      </Section>
    </div>
  );
}

function GitRow({ git }: { readonly git: GitStatus }) {
  return git._tag === "Available" ? (
    <Row
      dot="ready"
      icon={IconBrandGit}
      iconColor="text-[#f05032]"
      label="Git"
      summary="Available"
      version={git.version}
    />
  ) : (
    <Row
      dot="attention"
      icon={IconBrandGit}
      iconColor="text-[#f05032]"
      label="Git"
      summary="Not available on this server: Install Git from https://git-scm.com/downloads or with your package manager."
    />
  );
}

function HostRow({ host }: { readonly host: GitHostStatus }) {
  const descriptor = hostDescriptors[host.kind];
  const errorToast = useErrorToast();
  const setEnabled = useCommand(SourceControlApi.setHostEnabled);
  const common = {
    icon: descriptor.icon,
    iconColor: descriptor.color,
    label: descriptor.label,
  };
  if (host._tag === "ComingSoon")
    return (
      <Row
        {...common}
        badge="Coming Soon"
        dim
        dot="none"
        summary={`Support for ${descriptor.label} is coming soon.`}
      />
    );
  const signedIn = host._tag === "SignedIn";
  const enabled = setEnabled.running
    ? (setEnabled.input?.enabled ?? host.enabled)
    : host.enabled;
  return (
    <Row
      {...common}
      {...(host._tag === "SignedOut" ? { badge: "Not authenticated" } : {})}
      {...(host._tag === "Missing" ? {} : { version: host.version })}
      action={
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
      }
      dot={signedIn ? "ready" : "attention"}
      summary={
        host._tag === "SignedIn" ? (
          <>
            Authenticated as{" "}
            {host.accounts.map(({ host: server, account }, index) => (
              <Fragment key={server}>
                {index === 0 ? null : ", "}
                <HiddenAccount account={account} host={server} /> on {server}
              </Fragment>
            ))}
          </>
        ) : host._tag === "SignedOut" ? (
          descriptor.signIn
        ) : (
          <>Not available on this server: {descriptor.install}</>
        )
      }
    />
  );
}

function Section({
  title,
  action,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-2.5">
      <div className="flex min-h-7 items-center justify-between gap-4 px-3 sm:px-4">
        <h2 className="text-sm font-normal text-foreground/70">{title}</h2>
        {action}
      </div>
      <div className="rounded-xl border border-border/60 bg-card/40 [&>*+*]:border-t [&>*+*]:border-border/50">
        {children}
      </div>
    </section>
  );
}

function Row({
  icon: Icon,
  iconColor,
  dot,
  label,
  version,
  badge,
  summary,
  action,
  dim = false,
}: {
  readonly icon: TablerIcon;
  readonly iconColor: string;
  readonly dot: Dot;
  readonly label: string;
  readonly version?: string;
  readonly badge?: string;
  readonly summary: ReactNode;
  readonly action?: ReactNode;
  readonly dim?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 ${dim ? "opacity-80" : ""}`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
            <Icon aria-hidden="true" className={`size-4.5 ${iconColor}`} />
            {dot === "none" ? null : (
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute -top-0.5 -left-0.5 size-2 rounded-full ring-2 ring-repository ${dot === "ready" ? "bg-status-available" : "bg-status-connecting"}`}
              />
            )}
          </span>
          <span className="truncate text-sm font-medium text-foreground">
            {label}
          </span>
          {version === undefined ? null : (
            <code className="text-xs text-muted-foreground">{version}</code>
          )}
          {badge === undefined ? null : (
            <span className="inline-flex h-4 items-center rounded-[.25rem] bg-status-connecting/15 px-1 text-[.625rem] leading-none font-medium text-status-connecting">
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs leading-normal text-muted-foreground/80">
          {summary}
        </p>
      </div>
      {action === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      )}
    </div>
  );
}

function Checking({ failed }: { readonly failed: boolean }) {
  return (
    <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
      {failed ? "Could not scan this server." : "Scanning this server…"}
    </p>
  );
}

function HiddenAccount({
  account,
  host,
}: {
  readonly account: string;
  readonly host: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <button
      aria-label={
        shown ? `Hide account ${account} on ${host}` : `Show account on ${host}`
      }
      aria-pressed={shown}
      className={`cursor-pointer rounded-sm font-mono text-[.625rem] hover:text-foreground ${shown ? "text-foreground/90" : "blur-xs select-none"}`}
      onClick={() => setShown((current) => !current)}
      type="button"
    >
      {shown ? account : scrambled(account)}
    </button>
  );
}

function scrambled(value: string) {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(value, (character, index) =>
    "@.-_".includes(character)
      ? character
      : letters[(character.charCodeAt(0) * 7 + index * 13) % letters.length],
  ).join("");
}

function Code({ children }: { readonly children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-px text-[.625rem]">
      {children}
    </code>
  );
}
