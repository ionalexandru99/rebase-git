import {
  IconAlertCircle,
  IconCircleCheck,
  IconCircleFilled,
} from "@tabler/icons-react";
import { useLayoutEffect, useRef } from "react";

const fullTurnMs = 250;

type RingMotion = {
  readonly from: number;
  readonly to: number;
  readonly at: number;
};

export function NoticeIcon({
  type,
  percent,
  label,
  onFilled,
}: {
  readonly type: string | undefined;
  readonly percent: number | undefined;
  readonly label: string;
  readonly onFilled?: (() => void) | undefined;
}) {
  if ((type === "loading" || type === "success") && percent !== undefined)
    return (
      <ProgressRing
        percent={percent}
        done={type === "success"}
        label={label}
        onFilled={onFilled}
      />
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
  onFilled,
}: {
  readonly percent: number;
  readonly done: boolean;
  readonly label: string;
  readonly onFilled: (() => void) | undefined;
}) {
  const arc = useRef<SVGCircleElement>(null);
  const motion = useRef<RingMotion>({ from: 0, to: 0, at: 0 });
  const target = done ? 100 : percent;
  useLayoutEffect(() => {
    const now = performance.now();
    const from = position(motion.current, now);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ms = still ? 0 : (Math.abs(target - from) / 100) * fullTurnMs;
    motion.current = { from: still ? target : from, to: target, at: now };
    arc.current?.style.setProperty(
      "transition",
      still ? "none" : `stroke-dashoffset ${ms}ms linear, stroke 150ms`,
    );
    arc.current?.style.setProperty("stroke-dashoffset", `${100 - target}`);
    if (ms === 0 && target === 100) onFilled?.();
  }, [target, onFilled]);
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
          ref={arc}
          cx="8"
          cy="8"
          r="6"
          pathLength={100}
          strokeDasharray="100 200"
          onTransitionEnd={(event) => {
            if (
              event.propertyName === "stroke-dashoffset" &&
              position(motion.current, performance.now()) === 100
            )
              onFilled?.();
          }}
          className={done ? "stroke-status-available" : "stroke-primary"}
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

function position({ from, to, at }: RingMotion, now: number) {
  const travelled = ((now - at) / fullTurnMs) * 100;
  return from < to
    ? Math.min(to, from + travelled)
    : Math.max(to, from - travelled);
}
