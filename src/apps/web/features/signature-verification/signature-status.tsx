import {
  IconAlertTriangle,
  IconCircleX,
  IconClockX,
  IconHelpCircle,
  IconKeyOff,
  IconRosetteDiscountCheck,
  type TablerIcon,
} from "@tabler/icons-react";
import { skipToken } from "@tanstack/react-query";
import {
  type SignatureCheck,
  SignatureVerificationApi,
  type VerifySignature,
} from "#contracts/signature-verification/signature-verification.contract.ts";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { CopyPill } from "#web/features/clipboard/components/copy-pill.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";

type Shown = Exclude<SignatureCheck, { _tag: "Unsigned" }>;

const looks: Record<
  Shown["_tag"],
  { readonly label: string; readonly Icon: TablerIcon; readonly tone: string }
> = {
  Verified: {
    label: "Verified",
    Icon: IconRosetteDiscountCheck,
    tone: "text-success",
  },
  UnknownKey: {
    label: "Unknown key",
    Icon: IconHelpCircle,
    tone: "text-warning",
  },
  ExpiredKey: { label: "Expired key", Icon: IconClockX, tone: "text-warning" },
  RevokedKey: {
    label: "Revoked key",
    Icon: IconKeyOff,
    tone: "text-destructive",
  },
  BadSignature: {
    label: "Bad signature",
    Icon: IconCircleX,
    tone: "text-destructive",
  },
  CantCheck: {
    label: "Can't check",
    Icon: IconAlertTriangle,
    tone: "text-muted-foreground",
  },
};

export function SignatureStatus({
  kind,
  object,
}: Pick<VerifySignature, "kind" | "object">) {
  const scope = useRepositoryScope();
  const check = useEnvironmentQuery(
    SignatureVerificationApi.verify,
    scope === undefined
      ? skipToken
      : {
          repositoryId: scope.repositoryId,
          worktreePath: scope.worktreePath,
          kind,
          object,
        },
    { changes: "none", staleTime: 0 },
  );
  const result: SignatureCheck | undefined = check.isError
    ? { _tag: "CantCheck", reason: "Unreadable" }
    : check.data;
  if (result === undefined || result._tag === "Unsigned") return null;
  const { label, Icon, tone } = looks[result._tag];
  const key = "key" in result ? result.key : null;
  return (
    <Popover>
      <PopoverTrigger
        delay={0}
        openOnHover
        render={
          <button
            aria-label={`Signature: ${label}`}
            className={`inline-flex shrink-0 self-center rounded-control p-0.5 -m-0.5 align-middle outline-none hover:bg-accent focus-visible:outline-1 focus-visible:outline-primary ${tone}`}
            type="button"
          />
        }
      >
        <Icon aria-hidden="true" className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 px-3 py-2.5 text-meta"
        sideOffset={6}
      >
        <p
          className={`flex items-center gap-1.5 text-body font-semibold ${tone}`}
        >
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </p>
        <p className="mt-1 break-words text-muted-foreground">
          {describe(result)}
        </p>
        {key === null ? null : (
          <CopyPill
            value={key}
            className="mt-2 rounded-control bg-muted px-1.5 font-mono hover:text-foreground focus-visible:outline-1 focus-visible:outline-primary"
          >
            {shortKey(key)}
          </CopyPill>
        )}
      </PopoverContent>
    </Popover>
  );
}

function describe(result: Shown) {
  const by =
    result._tag !== "CantCheck" && result.signer !== null
      ? `Signed by ${result.signer}`
      : "Signed";
  switch (result._tag) {
    case "Verified":
      return `${by}.`;
    case "UnknownKey":
      return {
        KeyMissing: "This key isn't on this machine.",
        KeyNotTrusted: `${by}, but you haven't marked this key as trusted.`,
        NotAllowedSigner: "This key isn't in your allowed signers.",
      }[result.reason];
    case "ExpiredKey":
      return `${by}, but the key or the signature has expired.`;
    case "RevokedKey":
      return `${by} with a revoked key.`;
    case "BadSignature":
      return "The content doesn't match what was signed.";
    case "CantCheck":
      return {
        ToolMissing: "Git can't find the program that checks this signature.",
        AllowedSignersMissing:
          "Set gpg.ssh.allowedSignersFile to check SSH signatures.",
        TimedOut: "Checking took too long.",
        Unreadable: "Git couldn't check this signature.",
      }[result.reason];
  }
}

function shortKey(key: string) {
  return key.length > 24 ? `${key.slice(0, 14)}…${key.slice(-6)}` : key;
}
