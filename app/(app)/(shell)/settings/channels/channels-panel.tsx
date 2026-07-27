"use client";

/**
 * Настройки → Каналы: интерактивная часть на реальных данных
 * (docs/epics/epic_02/T-04-channels-settings.md). Список подключений,
 * форма добавления, инлайн-переименование, отключение/включение с
 * подтверждением — через Server Actions (`./actions.ts`).
 *
 * Подключение канала — OAuth-флоу: пользователь выбирает платформу и имя и
 * жмёт «Подключить», после чего `startChannelConnectionAction` возвращает
 * ссылку авторизации провайдера, и мы уходим на неё
 * (docs/architecture/05-channels.md). Строку подключения создаёт callback-роут
 * после авторизации. Пользователь нигде не вводит внешний ID и не видит
 * провайдера входящих.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { ChannelPlatform } from "@/lib/channels/types";

import { PlatformDot } from "../../_components/chips";
import setStyles from "../settings.module.css";
import uiStyles from "../../_components/ui.module.css";
import {
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

const PLATFORM_LABELS: Record<ChannelPlatform, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
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
  return `${PLATFORM_LABELS[channel.platform]} · ${STATUS_LABELS[channel.status]}`;
}

export function ChannelsPanel({
  channels,
  supportedPlatforms,
  connectResult = null,
}: {
  channels: ChannelConnectionListItem[];
  supportedPlatforms: ChannelPlatform[];
  connectResult?: ChannelConnectResult | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useActivityTransition("Обновляем каналы…");
  const [error, setError] = useState<string | null>(null);
  const connectedPlatforms = new Set(channels.map((channel) => channel.platform));
  const availablePlatforms = supportedPlatforms.filter(
    (candidate) => !connectedPlatforms.has(candidate),
  );

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [isAdding, setIsAdding] = useState(false);
  const [platform, setPlatform] = useState<ChannelPlatform>(
    availablePlatforms[0] ?? "telegram",
  );
  const [name, setName] = useState("");

  function startRename(channel: ChannelConnectionListItem) {
    setError(null);
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

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await startChannelConnectionAction({ platform, name });

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

      <div className={uiStyles.card}>
        {channels.length === 0 ? (
          <p className={setStyles.description}>
            Пока нет ни одного подключённого канала.
          </p>
        ) : null}
        {channels.map((channel) => (
          <div
            key={channel.id}
            className={setStyles.connectionRow}
            data-disconnected={channel.status !== "active"}
          >
            <PlatformDot platform={channel.platform} />
            {renamingId === channel.id ? (
              <form
                className={setStyles.renameForm}
                onSubmit={(event) => submitRename(event, channel.id)}
              >
                <input
                  autoFocus
                  aria-label={`Новое имя для «${channel.name}»`}
                  className={setStyles.renameInput}
                  onChange={(event) => setRenameValue(event.target.value)}
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
                  onClick={cancelRename}
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
                  onClick={() => startRename(channel)}
                  type="button"
                >
                  Переименовать
                </button>
                <button
                  className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonGhost}`}
                  disabled={isPending}
                  onClick={() => toggleStatus(channel)}
                  type="button"
                >
                  {channel.status === "active" ? "Отключить" : "Включить"}
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {isAdding ? (
        <form
          className={`${uiStyles.card} ${uiStyles.cardStack}`}
          onSubmit={submitCreate}
        >
          <div className={uiStyles.field}>
            <label htmlFor="channel-platform">Платформа</label>
            <select
              id="channel-platform"
              onChange={(event) => setPlatform(event.target.value as ChannelPlatform)}
              value={platform}
            >
              {availablePlatforms.map((option) => (
                <option key={option} value={option}>
                  {PLATFORM_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <div className={uiStyles.field}>
            <label htmlFor="channel-name">Имя подключения</label>
            <input
              id="channel-name"
              onChange={(event) => setName(event.target.value)}
              placeholder="Например, «WhatsApp Магазин»"
              type="text"
              value={name}
            />
            <span className={setStyles.fieldHint}>
              Дальше вы авторизуете аккаунт в выбранной соцсети — вводить ID
              вручную не нужно.
            </span>
          </div>
          <div className={uiStyles.cardRow}>
            <button
              className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Открываем авторизацию…" : "Подключить"}
            </button>
            <button
              className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
              disabled={isPending}
              onClick={() => setIsAdding(false)}
              type="button"
            >
              Отмена
            </button>
          </div>
        </form>
      ) : availablePlatforms.length > 0 ? (
        <button
          className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSelfStart}`}
          onClick={() => {
            setError(null);
            setIsAdding(true);
          }}
          type="button"
        >
          + Подключить канал
        </button>
      ) : (
        <p className={setStyles.description}>
          Все поддерживаемые платформы уже подключены.
        </p>
      )}
    </>
  );
}
