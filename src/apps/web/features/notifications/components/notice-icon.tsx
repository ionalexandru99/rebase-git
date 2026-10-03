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
  if ((type === "loading" || type === "success") && percent !== undefined)
    return (
      <ProgressRing percent={percent} done={type === "success"} label={label} />
    );
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

function ProgressRing({
  percent,
  done,
  label,
}: {
  readonly percent: number;
  readonly done: boolean;
  readonly label: string;
}) {
  return (
    <svg
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-hidden={done}
      className="mt-0.5 size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g transform="rotate(-90 8 8)">
        <circle cx="8" cy="8" r="6" className="stroke-foreground/15" />
        <circle
          cx="8"
          cy="8"
          r="6"
          pathLength={100}
          strokeDasharray="100 200"
          strokeDashoffset={done ? 0 : 100 - percent}
          className={`transition-[stroke-dashoffset,stroke] duration-150 motion-reduce:transition-none ${done ? "stroke-status-available" : "stroke-primary"}`}
        />
      </g>
      <path
        d="M6 8l1.5 1.5l3 -3"
        strokeWidth="1.5"
        className={`stroke-status-available transition-opacity duration-150 motion-reduce:transition-none ${done ? "opacity-100" : "opacity-0"}`}
      />
    </svg>
  );
}
