"use client";

/**
 * Настройки → Каналы: по блоку на платформу, разделённых горизонтальной
 * чертой (Instagram, Telegram, WhatsApp, Facebook, Email).
 *
 * Пока платформа не подключена, блок — это одна кнопка «Подключить <канал>»
 * со значком мессенджера. Для Instagram она раскрывает короткий онбординг с
 * предусловиями (профессиональный аккаунт, вход в нужный аккаунт в этом
 * браузере) и кнопкой «Войти через Instagram», которая запускает OAuth-флоу:
 * `startChannelConnectionAction` возвращает ссылку авторизации провайдера, и
 * мы уходим на неё (docs/architecture/05-channels.md). Строку подключения
 * создаёт callback-роут после авторизации — **имя канала подставляется из
 * имени аккаунта**, пользователь его не вводит и при необходимости
 * переименовывает позже. Остальные платформы пока показывают заглушку
 * «в разработке».
 *
 * Подключённый блок — строка канала с переименованием,
 * отключением/включением и удалением через Server Actions (`./actions.ts`).
 * Удаление необратимо (переписка канала уходит вместе с ним) и потому
 * спрашивает подтверждение прямо в блоке.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { CHANNEL_PLATFORM_LABELS } from "@/lib/channels/labels";
import type { ChannelPlatform } from "@/lib/channels/types";

import {
  FacebookIcon,
  InstagramIcon,
  MailIcon,
  TelegramIcon,
  TrashIcon,
  WhatsAppIcon,
} from "../../_components/icons";
import setStyles from "../settings.module.css";
import uiStyles from "../../_components/ui.module.css";
import {
  deleteChannelConnectionAction,
  renameChannelConnectionAction,
  setChannelConnectionStatusAction,
  startChannelConnectionAction,
} from "./actions";
import { useActivityTransition } from "../../_components/activity";

export type ChannelConnectionListItem = {
  id: string;
  name: string;
  platform: ChannelPlatform;
  status: "active" | "disconnected" | "error";
};

/** Result banner after returning from the OAuth connect flow (callback route). */
export type ChannelConnectResult = {
  status: "connected" | "error";
  reason: string | null;
};

/**
 * Ключ блока. Email — пока только UI-заглушка: своего `ChannelPlatform` (и
 * адаптера) у него нет, он появится вместе с почтовым провайдером
 * (docs/architecture/05-channels.md).
 */
type ChannelBlockKey = ChannelPlatform | "email";

type ChannelBlock = {
  key: ChannelBlockKey;
  label: string;
  Icon: typeof InstagramIcon;
  /**
   * Платформа, для которой запускается подключение; `null` — флоу ещё не
   * готов, блок показывает заглушку «в разработке».
   */
  connect: ChannelPlatform | null;
};

/** Порядок блоков на странице. */
const CHANNEL_BLOCKS: readonly ChannelBlock[] = [
  {
    key: "instagram",
    label: CHANNEL_PLATFORM_LABELS.instagram,
    Icon: InstagramIcon,
    connect: "instagram",
  },
  {
    key: "telegram",
    label: CHANNEL_PLATFORM_LABELS.telegram,
    Icon: TelegramIcon,
    connect: null,
  },
  {
    key: "whatsapp",
    label: CHANNEL_PLATFORM_LABELS.whatsapp,
    Icon: WhatsAppIcon,
    connect: null,
  },
  {
    key: "facebook",
    label: CHANNEL_PLATFORM_LABELS.facebook,
    Icon: FacebookIcon,
    connect: null,
  },
  { key: "email", label: "Email", Icon: MailIcon, connect: null },
];

/**
 * Предусловия, без которых подключение аккаунта сорвётся или подключится не
 * тот аккаунт. Показываем их до ухода на авторизацию — вернуться и всё
 * переделать дороже.
 */
const CONNECT_PREREQUISITES: Readonly<Record<ChannelPlatform, string[]>> = {
  instagram: [
    "Аккаунт Instagram переведён в профессиональный — Business или Creator. Личные аккаунты подключить нельзя.",
    "В этом браузере вы уже вошли именно в тот аккаунт Instagram, который подключаете, — иначе на следующем шаге легко подключить чужой аккаунт.",
    "У вас есть права на управление этим аккаунтом.",
  ],
  telegram: [],
  whatsapp: [],
  facebook: [],
};

const STATUS_LABELS: Record<ChannelConnectionListItem["status"], string> = {
  active: "подключён",
  disconnected: "отключён",
  error: "ошибка подключения",
};

const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  duplicate: "Канал этой платформы уже подключён к рабочему пространству.",
  state: "Сессия подключения истекла или недействительна. Попробуйте снова.",
  provider: "Подключение через этот канал сейчас недоступно.",
  callback: "Провайдер не завершил подключение. Попробуйте снова.",
  failed: "Не удалось создать подключение. Попробуйте снова.",
};

function statusLine(channel: ChannelConnectionListItem): string {
  return `${CHANNEL_PLATFORM_LABELS[channel.platform]} · ${STATUS_LABELS[channel.status]}`;
}

export function ChannelsPanel({
  channels,
  connectResult = null,
}: {
  channels: ChannelConnectionListItem[];
  connectResult?: ChannelConnectResult | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useActivityTransition("Обновляем каналы…");
  const [error, setError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  /** Канал, для которого показано подтверждение удаления. */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /** Провайдер не подтвердил отключение аккаунта — канал всё равно удалён. */
  const [notice, setNotice] = useState<string | null>(null);

  /** Блок, раскрытый в онбординг перед авторизацией. */
  const [onboardingKey, setOnboardingKey] = useState<ChannelBlockKey | null>(null);
  /** Блок, для которого показана заглушка «в разработке». */
  const [stubKey, setStubKey] = useState<ChannelBlockKey | null>(null);

  function startRename(channel: ChannelConnectionListItem) {
    setError(null);
    setDeletingId(null);
    setRenamingId(channel.id);
    setRenameValue(channel.name);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
  }

  function submitRename(event: FormEvent, id: string) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await renameChannelConnectionAction({ id, name: renameValue });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setRenamingId(null);
      setRenameValue("");
      router.refresh();
    });
  }

  function toggleStatus(channel: ChannelConnectionListItem) {
    setError(null);
    const nextStatus = channel.status === "active" ? "disconnected" : "active";

    if (
      nextStatus === "disconnected" &&
      typeof window !== "undefined" &&
      !window.confirm(
        `Отключить канал «${channel.name}»? Диалоги и сообщения сохранятся — новые входящие перестанут приходить.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await setChannelConnectionStatusAction({
        id: channel.id,
        status: nextStatus,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      router.refresh();
    });
  }

  function startDelete(channel: ChannelConnectionListItem) {
    setError(null);
    setNotice(null);
    setRenamingId(null);
    setDeletingId(channel.id);
  }

  function cancelDelete() {
    setDeletingId(null);
  }

  /**
   * Удаление канала: строка `channel_connections` уходит вместе со своей
   * перепиской, а аккаунт отключается у провайдера. В соцсети ничего не
   * удаляется.
   */
  function confirmDelete(channel: ChannelConnectionListItem) {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await deleteChannelConnectionAction({ id: channel.id });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setDeletingId(null);
      if (result.warning) {
        setNotice(result.warning);
      }
      router.refresh();
    });
  }

  /** Кнопка «Подключить …»: онбординг для готовых платформ, заглушка для остальных. */
  function openConnect(block: ChannelBlock) {
    setError(null);

    if (!block.connect) {
      setOnboardingKey(null);
      setStubKey(block.key);
      return;
    }

    setStubKey(null);
    setOnboardingKey(block.key);
  }

  function closeConnect() {
    setOnboardingKey(null);
    setStubKey(null);
  }

  /** «Войти через …» — уходим на страницу авторизации провайдера. */
  function submitConnect(platform: ChannelPlatform) {
    setError(null);

    startTransition(async () => {
      const result = await startChannelConnectionAction({ platform });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Hand off to the provider's authorization page; the callback route
      // creates the connection and redirects back to Settings → Channels.
      window.location.assign(result.url);
    });
  }

  const connectBanner =
    connectResult?.status === "connected"
      ? { kind: "success" as const, text: "Канал подключён." }
      : connectResult?.status === "error"
        ? {
            kind: "error" as const,
            text:
              CONNECT_ERROR_MESSAGES[connectResult.reason ?? ""] ??
              "Не удалось подключить канал.",
          }
        : null;

  return (
    <>
      {connectBanner ? (
        <p
          aria-live="polite"
          className={
            connectBanner.kind === "success"
              ? setStyles.description
              : setStyles.formError
          }
        >
          {connectBanner.text}
        </p>
      ) : null}
      {error ? (
        <p aria-live="polite" className={setStyles.formError}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p aria-live="polite" className={setStyles.description}>
          {notice}
        </p>
      ) : null}

      <div className={uiStyles.card}>
        {CHANNEL_BLOCKS.map((block) => {
          const channel = channels.find((entry) => entry.platform === block.key);
          const connectPlatform = block.connect;

          return (
            <section key={block.key} className={setStyles.channelBlock}>
              {channel ? (
                deletingId === channel.id ? (
                  <DeleteConfirmation
                    block={block}
                    channel={channel}
                    isPending={isPending}
                    onCancel={cancelDelete}
                    onConfirm={() => confirmDelete(channel)}
                  />
                ) : (
                  <ConnectedChannel
                    block={block}
                    channel={channel}
                    isPending={isPending}
                    isRenaming={renamingId === channel.id}
                    onCancelRename={cancelRename}
                    onRenameChange={setRenameValue}
                    onStartDelete={startDelete}
                    onStartRename={startRename}
                    onSubmitRename={submitRename}
                    onToggleStatus={toggleStatus}
                    renameValue={renameValue}
                  />
                )
              ) : onboardingKey === block.key && connectPlatform ? (
                <ConnectOnboarding
                  block={block}
                  isPending={isPending}
                  onCancel={closeConnect}
                  onSubmit={() => submitConnect(connectPlatform)}
                />
              ) : (
                <>
                  <button
                    className={`${uiStyles.button} ${uiStyles.buttonSecondary} ${setStyles.channelConnectButton}`}
                    disabled={isPending}
                    onClick={() => openConnect(block)}
                    type="button"
                  >
                    <ChannelIcon block={block} />
                    Подключить {block.label}
                  </button>
                  {stubKey === block.key ? (
                    <p aria-live="polite" className={setStyles.channelStub}>
                      Подключение канала «{block.label}» пока в разработке — мы
                      добавим его в одном из ближайших обновлений.
                    </p>
                  ) : null}
                </>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function ChannelIcon({ block }: { block: ChannelBlock }) {
  const { Icon } = block;

  return (
    <span className={setStyles.channelIcon} data-platform={block.key}>
      <Icon size={16} />
    </span>
  );
}

/** Онбординг перед авторизацией: предусловия + «Войти через …». */
function ConnectOnboarding({
  block,
  isPending,
  onCancel,
  onSubmit,
}: {
  block: ChannelBlock;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const prerequisites = block.connect
    ? CONNECT_PREREQUISITES[block.connect]
    : [];

  return (
    <div className={setStyles.channelOnboarding}>
      <b>
        <ChannelIcon block={block} />
        Перед подключением {block.label} проверьте
      </b>
      <ul>
        {prerequisites.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className={setStyles.channelStub}>
        Имя канала подставится автоматически из имени аккаунта — переименовать
        его можно позже.
      </p>
      <div className={uiStyles.cardRow}>
        <button
          className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
          disabled={isPending}
          onClick={onSubmit}
          type="button"
        >
          {isPending ? "Открываем авторизацию…" : `Войти через ${block.label}`}
        </button>
        <button
          className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
          disabled={isPending}
          onClick={onCancel}
          type="button"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

/**
 * Подтверждение удаления канала: что именно исчезнет и где останется. Стоит
 * вместо строки канала — как онбординг вместо кнопки подключения.
 */
function DeleteConfirmation({
  block,
  channel,
  isPending,
  onCancel,
  onConfirm,
}: {
  block: ChannelBlock;
  channel: ChannelConnectionListItem;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-label={`Удалить канал «${channel.name}»`}
      className={setStyles.channelOnboarding}
      role="alertdialog"
    >
      <b>
        <ChannelIcon block={block} />
        Удалить канал «{channel.name}»?
      </b>
      <p className={setStyles.channelStub}>
        Все сообщения и комментарии этого канала перестанут отображаться в
        drafta, а новые приходить не будут. В {block.label} они останутся —
        оттуда ничего не удаляется. Подключить канал заново можно в любой
        момент.
      </p>
      <div className={uiStyles.cardRow}>
        <button
          className={`${uiStyles.button} ${setStyles.buttonDangerFilled}`}
          disabled={isPending}
          onClick={onConfirm}
          type="button"
        >
          {isPending ? "Удаляем…" : "Удалить канал"}
        </button>
        <button
          className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
          disabled={isPending}
          onClick={onCancel}
          type="button"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

/** Подключённый канал: имя из аккаунта, статус, переименование, отключение, удаление. */
function ConnectedChannel({
  block,
  channel,
  isPending,
  isRenaming,
  onCancelRename,
  onRenameChange,
  onStartDelete,
  onStartRename,
  onSubmitRename,
  onToggleStatus,
  renameValue,
}: {
  block: ChannelBlock;
  channel: ChannelConnectionListItem;
  isPending: boolean;
  isRenaming: boolean;
  onCancelRename: () => void;
  onRenameChange: (value: string) => void;
  onStartDelete: (channel: ChannelConnectionListItem) => void;
  onStartRename: (channel: ChannelConnectionListItem) => void;
  onSubmitRename: (event: FormEvent, id: string) => void;
  onToggleStatus: (channel: ChannelConnectionListItem) => void;
  renameValue: string;
}) {
  return (
    <div
      className={setStyles.connectionRow}
      data-disconnected={channel.status !== "active"}
    >
      <ChannelIcon block={block} />
      {isRenaming ? (
        <form
          className={setStyles.renameForm}
          onSubmit={(event) => onSubmitRename(event, channel.id)}
        >
          <input
            autoFocus
            aria-label={`Новое имя для «${channel.name}»`}
            className={setStyles.renameInput}
            onChange={(event) => onRenameChange(event.target.value)}
            type="text"
            value={renameValue}
          />
          <button
            className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonPrimary}`}
            disabled={isPending}
            type="submit"
          >
            Сохранить
          </button>
          <button
            className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonGhost}`}
            disabled={isPending}
            onClick={onCancelRename}
            type="button"
          >
            Отмена
          </button>
        </form>
      ) : (
        <>
          <div className={setStyles.connectionBody}>
            <b>{channel.name}</b>
            <span>{statusLine(channel)}</span>
          </div>
          <button
            className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonSecondary}`}
            disabled={isPending}
            onClick={() => onStartRename(channel)}
            type="button"
          >
            Переименовать
          </button>
          <button
            className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonGhost}`}
            disabled={isPending}
            onClick={() => onToggleStatus(channel)}
            type="button"
          >
            {channel.status === "active" ? "Отключить" : "Включить"}
          </button>
          <button
            aria-label={`Удалить канал «${channel.name}»`}
            className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonGhost} ${uiStyles.buttonDanger} ${setStyles.channelDeleteButton}`}
            disabled={isPending}
            onClick={() => onStartDelete(channel)}
            title="Удалить канал"
            type="button"
          >
            <TrashIcon />
          </button>
        </>
      )}
    </div>
  );
}
