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

/**
 * Публикации: стопка карточек — лента постов. `CommentsIcon` осталась речевым
 * пузырём и используется плейсхолдером превью поста в списке.
 */
export function PostsIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7.5 4.5h11a1.8 1.8 0 0 1 1.8 1.8v9" />
      <rect x="3.5" y="8" width="13" height="11.5" rx="2" />
      <path d="M6.7 12h6.6M6.7 15.4h4" />
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

/* ---------- иконки разделов настроек (settings/page.tsx) ---------- */

/** Каналы: вилка-коннектор — «подключение». */
export function PlugIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 3v5M15 3v5" />
      <path d="M6.5 8h11v2.5a5.5 5.5 0 0 1-11 0V8Z" />
      <path d="M12 16v5" />
    </Icon>
  );
}

/** Категории: ярлык с отверстием. */
export function TagIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M11.2 3.5H20.5v9.3l-8.6 8.6a1.6 1.6 0 0 1-2.3 0l-7-7a1.6 1.6 0 0 1 0-2.3l8.6-8.6Z" />
      <circle cx="16.6" cy="7.4" r="1.4" />
    </Icon>
  );
}

/** База знаний: раскрытая книга. */
export function BookIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 6.5C10.4 5.2 8.4 4.5 5.5 4.5H4v13h1.5c2.9 0 4.9.7 6.5 2 1.6-1.3 3.6-2 6.5-2H20v-13h-1.5c-2.9 0-4.9.7-6.5 2Z" />
      <path d="M12 6.5v13" />
    </Icon>
  );
}

/** Шаблоны ответов: лист с заготовленными строками текста. */
export function TemplateIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
      <path d="M8 8.5h8M8 12h8M8 15.5h4.5" />
    </Icon>
  );
}

/** Команда: два силуэта. */
export function TeamIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="9.5" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c1-2.8 3.2-4.3 6-4.3s5 1.5 6 4.3" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 5.9" />
      <path d="M17.6 15.6c1.4.6 2.5 1.9 3.1 3.9" />
    </Icon>
  );
}

/** Уведомления: колокольчик. */
export function BellIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3.2.7 5 1.8 6.5H4.7C5.8 15 6.5 13.2 6.5 10Z" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
    </Icon>
  );
}

/** Приложение: телефон со стрелкой установки. */
export function DeviceIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="6.5" y="2.8" width="11" height="18.4" rx="2.4" />
      <path d="M12 7v6.5M9.5 11.2 12 13.8l2.5-2.6" />
      <path d="M10.5 18.4h3" />
    </Icon>
  );
}

/** Приватность: щит. */
export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3.2 5 6v5.4c0 4.2 2.8 7.5 7 9.4 4.2-1.9 7-5.2 7-9.4V6l-7-2.8Z" />
      <path d="m9 12 2.2 2.2L15.4 10" />
    </Icon>
  );
}

/** Аккаунт: силуэт в круге. */
export function AccountIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <circle cx="12" cy="10" r="2.9" />
      <path d="M6.6 18.6c1.2-2 3.1-3 5.4-3s4.2 1 5.4 3" />
    </Icon>
  );
}

/* ---------- значки платформ (настройки → каналы) ---------- */

/** Instagram: скруглённый квадрат с объективом. */
export function InstagramIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeWidth={1.9} {...props}>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="16.9" cy="7.1" r="1.15" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Telegram: бумажный самолётик. */
export function TelegramIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeWidth={1.8} strokeLinejoin="round" {...props}>
      <path d="M21 4 3 10.8l6.2 2.4L21 4Z" />
      <path d="M21 4 9.2 13.2V20l3.3-4L21 4Z" />
    </Icon>
  );
}

/** WhatsApp: трубка в облачке сообщения. */
export function WhatsAppIcon(props: IconProps) {
  return (
    <Icon
      {...stroke}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M20.4 11.8a8.4 8.4 0 0 1-12.5 7.3l-4.3 1.3 1.3-4.3A8.4 8.4 0 1 1 20.4 11.8Z" />
      <path d="M9.4 8.9c.3-.5.9-.5 1.2 0l.7 1.3-.9 1a4.9 4.9 0 0 0 2.4 2.4l1-.9 1.3.7c.5.3.5.9 0 1.2-1 .6-2.2.4-3.5-.5a9 9 0 0 1-2.4-2.6c-.9-1.4-1-2.6-.4-3.6Z" />
    </Icon>
  );
}

/** Facebook: «f» в круге. */
export function FacebookIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeWidth={1.9} strokeLinecap="round" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14 7.9h-1.3a1.9 1.9 0 0 0-1.9 1.9v6.6M9.5 12.1h4" />
    </Icon>
  );
}

/** Email: конверт. */
export function MailIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeWidth={1.8} strokeLinejoin="round" {...props}>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m4.2 8.2 7.8 5 7.8-5" />
    </Icon>
  );
}

/** Refresh: two circular arrows. */
export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M6.1 8.1A7.5 7.5 0 0 1 18.6 6L20 7.4" />
      <path d="M17.9 15.9A7.5 7.5 0 0 1 5.4 18L4 16.6" />
    </Icon>
  );
}

/** Удаление: корзина. */
export function TrashIcon(props: IconProps) {
  return (
    <Icon
      size={15}
      {...stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4.5 6.5h15" />
      <path d="M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
      <path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" />
      <path d="M10.5 10v6.5M13.5 10v6.5" />
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

export function CheckIcon(props: IconProps) {
  return (
    <Icon
      size={14}
      {...stroke}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Icon>
  );
}

/** Закрыть — крестик у поля ответа под комментарием. */
export function CloseIcon(props: IconProps) {
  return (
    <Icon
      size={14}
      {...stroke}
      strokeWidth={2}
      strokeLinecap="round"
      {...props}
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon
      size={14}
      {...stroke}
      strokeWidth={2}
      strokeLinecap="round"
      {...props}
    >
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <Icon
      size={16}
      {...stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3" />
      <path d="M10 8.5L6 12l4 3.5" />
      <path d="M6 12h8" />
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

export function WarningIcon(props: IconProps) {
  return (
    <Icon size={14} {...stroke} strokeLinecap="round" {...props}>
      <path d="M12 4.5 3 19.5h18L12 4.5Z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.2v.1" />
    </Icon>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Icon size={14} fill="currentColor" {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
    </Icon>
  );
}

/**
 * Перевод сообщения. Классический «А→文»: буква латиницы и иероглиф со стрелкой
 * между ними — узнаётся без подписи и не путается с глобусом (тот в интерфейсах
 * обычно означает выбор языка, а не действие).
 */
export function TranslateIcon(props: IconProps) {
  return (
    <Icon size={14} {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 6h7" />
      <path d="M6.5 6V4.2" />
      <path d="M8.6 6c0 3.1-2 5.6-5.1 6.6" />
      <path d="M5 9.4c.9 1.7 2.4 2.7 4.2 3.2" />
      <path d="m13 20 3.8-9 3.8 9" />
      <path d="M14.4 16.8h4.8" />
    </Icon>
  );
}

/** Возврат к оригиналу под переведённым сообщением. */
export function UndoIcon(props: IconProps) {
  return (
    <Icon size={14} {...stroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 7 5 11l4 4" />
      <path d="M5 11h8.5a4.5 4.5 0 0 1 0 9H11" />
    </Icon>
  );
}
