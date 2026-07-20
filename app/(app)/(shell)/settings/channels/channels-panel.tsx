"use client";

/**
 * Настройки → Каналы: интерактивная часть на реальных данных
 * (docs/epics/epic_02/T-04-channels-settings.md). Список подключений,
 * форма добавления, инлайн-переименование, отключение/включение с
 * подтверждением — через Server Actions (`./actions.ts`).
 *
 * Открытый вопрос №1 эпика: привязка аккаунта соцсети — на стороне Zernio
 * (их дашборд); наш адаптер (T-01/T-02) пока не реализует опциональную
 * `getConnectUrl`, поэтому здесь всегда простое поле ввода внешнего ID с
 * подсказкой, а не кнопка-ссылка «Подключить в Zernio».
 */

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { ChannelPlatform } from "@/lib/channels/types";

import { PlatformDot } from "../../_components/chips";
import setStyles from "../settings.module.css";
import uiStyles from "../../_components/ui.module.css";
import {
  createChannelConnectionAction,
  renameChannelConnectionAction,
  setChannelConnectionStatusAction,
} from "./actions";

export type ChannelConnectionListItem = {
  id: string;
  name: string;
  platform: ChannelPlatform;
  externalId: string;
  status: "active" | "disconnected" | "error";
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

function statusLine(channel: ChannelConnectionListItem): string {
  return `${PLATFORM_LABELS[channel.platform]} · ${STATUS_LABELS[channel.status]} · ID ${channel.externalId} · через Zernio`;
}

export function ChannelsPanel({
  channels,
  supportedPlatforms,
}: {
  channels: ChannelConnectionListItem[];
  supportedPlatforms: ChannelPlatform[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [isAdding, setIsAdding] = useState(false);
  const [platform, setPlatform] = useState<ChannelPlatform>(
    supportedPlatforms[0] ?? "telegram",
  );
  const [externalId, setExternalId] = useState("");
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
      const result = await createChannelConnectionAction({ platform, externalId, name });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setIsAdding(false);
      setPlatform(supportedPlatforms[0] ?? "telegram");
      setExternalId("");
      setName("");
      router.refresh();
    });
  }

  return (
    <>
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
              {supportedPlatforms.map((option) => (
                <option key={option} value={option}>
                  {PLATFORM_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <div className={uiStyles.field}>
            <label htmlFor="channel-external-id">Внешний ID аккаунта</label>
            <input
              id="channel-external-id"
              onChange={(event) => setExternalId(event.target.value)}
              type="text"
              value={externalId}
            />
            <span className={setStyles.fieldHint}>
              Привязка аккаунта соцсети происходит в дашборде Zernio — скопируйте
              оттуда внешний ID подключаемого аккаунта.
            </span>
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
          </div>
          <div className={uiStyles.cardRow}>
            <button
              className={`${uiStyles.button} ${uiStyles.buttonPrimary}`}
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Подключаем…" : "Подключить канал"}
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
      ) : (
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
      )}
    </>
  );
}
