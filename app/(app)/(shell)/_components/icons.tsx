/** Иконки интерфейса, перенесённые из макета `docs/references/ui-mockup.html`. */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
} as const;

export function DashboardIcon(props: IconProps) {
  return (
    <Icon {...stroke} {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

export function MessagesIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinejoin="round" {...props}>
      <path d="M4 5.5h16v11H9l-5 4v-15z" />
    </Icon>
  );
}

export function CommentsIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinejoin="round" strokeLinecap="round" {...props}>
      <path d="M4 5.5h16v11H9l-5 4v-15z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </Icon>
  );
}

export function ContactsIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c1.4-3.2 4.2-4.8 7.5-4.8s6.1 1.6 7.5 4.8" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" {...props}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2.2" />
      <circle cx="10" cy="17" r="2.2" />
    </Icon>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <Icon
      size={14}
      {...stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <Icon
      size={20}
      {...stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M15 5l-7 7 7 7" />
    </Icon>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Icon size={13} fill="currentColor" {...props}>
      <path d="M12 2l2.3 7.7L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3z" />
    </Icon>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Icon
      size={16}
      {...stroke}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 3L10.5 13.5M21 3l-6.8 18-3.7-8.3L2 9z" />
    </Icon>
  );
}

export function RegenerateIcon(props: IconProps) {
  return (
    <Icon
      size={14}
      {...stroke}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M20 12a8 8 0 1 1-2.2-5.5M18.5 3v4h-4" />
    </Icon>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <Icon
      size={12}
      {...stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9 5H5v14h14v-4M14 4h6v6M20 4l-9 9" />
    </Icon>
  );
}

export function PictureIcon(props: IconProps) {
  return (
    <Icon size={14} {...stroke} strokeLinejoin="round" {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l5-4 3 2.5L16 12l4.5 5" />
    </Icon>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <Icon size={14} fill="currentColor" {...props}>
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </Icon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Icon size={13} {...stroke} {...props}>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon size={12} {...stroke} strokeLinecap="round" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}
