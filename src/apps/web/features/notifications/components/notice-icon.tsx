import {
  IconAlertCircle,
  IconCircleCheck,
  IconCircleFilled,
} from "@tabler/icons-react";

export function NoticeIcon({
  type,
  percent,
  label,
}: {
  readonly type: string | undefined;
  readonly percent: number | undefined;
  readonly label: string;
}) {
  if (type === "loading" && percent !== undefined)
    return <ProgressRing percent={percent} label={label} />;
  if (type === "loading")
    return (
      <span
        aria-hidden="true"
        className="flex h-5 w-4 shrink-0 items-center justify-center"
      >
        <IconCircleFilled className="size-2 text-status-connecting" />
      </span>
    );
  return type === "success" ? (
    <IconCircleCheck
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-status-available"
    />
  ) : (
    <IconAlertCircle
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0 text-status-unavailable"
    />
  );
}

const ringRadius = 6;
const ringLength = 2 * Math.PI * ringRadius;

function ProgressRing({
  percent,
  label,
}: {
  readonly percent: number;
  readonly label: string;
}) {
  return (
    <svg
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="mt-0.5 size-4 shrink-0 -rotate-90"
      viewBox="0 0 16 16"
    >
      <circle
        cx="8"
        cy="8"
        r={ringRadius}
        fill="none"
        strokeWidth="2"
        className="stroke-foreground/15"
      />
      <circle
        cx="8"
        cy="8"
        r={ringRadius}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={ringLength}
        strokeDashoffset={ringLength * (1 - percent / 100)}
        className="stroke-primary transition-[stroke-dashoffset] duration-150 motion-reduce:transition-none"
      />
    </svg>
  );
}
