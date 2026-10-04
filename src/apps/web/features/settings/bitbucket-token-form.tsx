import { IconAlertTriangle } from "@tabler/icons-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import {
  type BitbucketToken,
  bitbucketApiTokenScopes,
  SourceControlApi,
} from "#contracts/source-control/source-control.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { SettingsField } from "#web/components/ui/settings-layout.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "#web/components/ui/tabs.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { useCommand } from "#web/platform/query/use-command.ts";

type Method = BitbucketToken["_tag"];

const methods: Record<
  Method,
  {
    readonly label: string;
    readonly description: (missing: readonly string[]) => ReactNode;
  }
> = {
  AccessToken: {
    label: "Access token",
    description: () => (
      <>
        Scoped to one repository, project or workspace. Create it in that item's
        Bitbucket settings with{" "}
        <Scopes
          label="read access"
          missing={[]}
          scopes={["Repositories: Read", "Pull requests: Read"]}
        />
        .
      </>
    ),
  },
  ApiToken: {
    label: "API token",
    description: (missing) => (
      <>
        Uses your Atlassian account, so it reaches every repository you can.
        Create it at https://id.atlassian.com/manage-profile/security/api-tokens
        with{" "}
        <Scopes
          label="four read scopes"
          missing={missing}
          scopes={bitbucketApiTokenScopes}
        />
        .
      </>
    ),
  },
};

const tokenFailures = {
  BitbucketTokenRejected: ({ reason }: { readonly reason: string }) =>
    reason === "Invalid"
      ? "Bitbucket did not accept this email and API token."
      : reason === "MissingScope"
        ? "This API token is missing one of the four read scopes."
        : "Could not reach Bitbucket to check this token. Try again.",
};

export function BitbucketTokenForm({
  saved,
  onSaved,
}: {
  readonly saved: BitbucketToken | null;
  readonly onSaved: () => void;
}) {
  const id = useId();
  const errorToast = useErrorToast();
  const save = useCommand(SourceControlApi.saveBitbucketToken);
  const remove = useCommand(SourceControlApi.removeBitbucketToken);
  const [method, setMethod] = useState<Method>(saved?._tag ?? "AccessToken");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState(
    saved?._tag === "ApiToken" ? saved.email : "",
  );
  const busy = save.running || remove.running;
  const request =
    method === "AccessToken"
      ? { _tag: method, token: token.trim() }
      : { _tag: method, email: email.trim(), token: token.trim() };
  const ready =
    request.token !== "" && (request._tag === "AccessToken" || request.email);
  const edit = (change: () => void) => {
    change();
    save.reset();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    const result = await save.run(request);
    if (result._tag !== "Ok") return;
    setToken("");
    onSaved();
  };

  const tokenField = (label: string) => (
    <SettingsField id={`${id}-token`} label={label}>
      <Input
        autoComplete="off"
        id={`${id}-token`}
        onChange={(event) => edit(() => setToken(event.target.value))}
        placeholder={
          saved?._tag === method
            ? "Saved. Enter a new token to replace it"
            : "Not set"
        }
        type="password"
        value={token}
      />
    </SettingsField>
  );

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <Tabs
        className="gap-3"
        onValueChange={(value: Method) => edit(() => setMethod(value))}
        value={method}
      >
        <TabsList
          aria-label="Bitbucket token kind"
          className="w-fit rounded-lg bg-muted/50 p-0.5"
        >
          {(Object.keys(methods) as Method[]).map((kind) => (
            <TabsTrigger
              className="h-7 rounded-md px-3 text-sm data-active:bg-background"
              key={kind}
              value={kind}
            >
              {methods[kind].label}
            </TabsTrigger>
          ))}
        </TabsList>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {methods[method].description(
            saved?._tag === method && saved._tag === "ApiToken"
              ? saved.missingScopes
              : [],
          )}
        </p>
        <TabsContent className="grid gap-4" value="AccessToken">
          {tokenField("Access token")}
        </TabsContent>
        <TabsContent className="grid gap-4" value="ApiToken">
          <SettingsField id={`${id}-email`} label="Atlassian account email">
            <Input
              autoComplete="off"
              id={`${id}-email`}
              onChange={(event) => edit(() => setEmail(event.target.value))}
              placeholder="you@example.com"
              type="email"
              value={email}
            />
          </SettingsField>
          {tokenField("API token")}
        </TabsContent>
      </Tabs>
      <div className="flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {save.failure !== undefined ? (
            <span className="text-destructive">
              {describeFailure(save.failure, tokenFailures)}
            </span>
          ) : saved !== null && saved._tag !== method ? (
            `Saving replaces your ${methods[saved._tag].label.toLowerCase()}.`
          ) : null}
        </p>
        <div className="flex shrink-0 gap-2">
          {saved === null ? null : (
            <Button
              disabled={busy}
              onClick={async () => {
                save.reset();
                errorToast.failure("saveSourceControl", await remove.run());
              }}
              size="xs"
              type="button"
              variant="outline"
            >
              Remove
            </Button>
          )}
          <Button disabled={!ready || busy} size="xs" type="submit">
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

function Scopes({
  label,
  scopes,
  missing,
}: {
  readonly label: string;
  readonly scopes: readonly string[];
  readonly missing: readonly string[];
}) {
  return (
    <Popover>
      <PopoverTrigger
        delay={150}
        openOnHover
        render={
          <button
            className={`cursor-help underline decoration-muted-foreground/70 decoration-dotted underline-offset-[3px] outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/30 ${missing.length > 0 ? "text-status-connecting" : "text-foreground/90"}`}
            type="button"
          />
        }
      >
        {label}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto px-2.5 py-2"
        side="top"
        sideOffset={4}
      >
        <ul aria-label="Required scopes" className="space-y-0.5">
          {scopes.map((scope) =>
            missing.includes(scope) ? (
              <li
                aria-label={`${scope} missing`}
                className="flex items-center gap-1.5 font-mono text-[.7rem] leading-5 text-status-connecting"
                key={scope}
              >
                {scope}
                <IconAlertTriangle aria-hidden="true" className="size-3" />
              </li>
            ) : (
              <li className="font-mono text-[.7rem] leading-5" key={scope}>
                {scope}
              </li>
            ),
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
