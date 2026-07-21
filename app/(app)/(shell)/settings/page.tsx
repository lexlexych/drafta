import Link from "next/link";

import {
  AI_SETTINGS_OPTIONS,
  SETTINGS_SECTIONS,
  getAiSettings,
  getNotificationSettings,
  getSettingsCategories,
  getSettingsTeam,
  getWorkspace,
  isSettingsSectionId,
  type SettingsSectionId,
} from "@/lib/mock";
import {
  SUPPORTED_CHANNEL_PLATFORMS,
  listChannelConnections,
} from "@/lib/db/channel-connections";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

import { Avatar } from "../_components/avatar";
import { BackIcon, GripIcon, LockIcon, SettingsIcon } from "../_components/icons";
import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import { StubButton } from "../_components/stub";
import {
  ChannelsPanel,
  type ChannelConnectionListItem,
  type ChannelConnectResult,
} from "./channels/channels-panel";
import setStyles from "./settings.module.css";
import styles from "../_components/panes.module.css";
import uiStyles from "../_components/ui.module.css";

const PATHNAME = "/settings";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Loads the current workspace's `channel_connections` for the Channels
 * section (T-04) — real data, unlike the rest of this page (still mock,
 * T-07 UI-каркас, replaced section by section in later epics). Only called
 * when the Channels section is actually being rendered, so the other
 * sections (categories, ai, team…) stay Supabase-free, same as before this
 * ticket.
 */
async function loadChannelsSectionData(): Promise<ChannelConnectionListItem[]> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return [];
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return [];
  }

  const supabase = await createServerSupabaseClient();
  const rows = await listChannelConnections(supabase, workspace.id);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    platform: row.platform,
    status: row.status,
  }));
}

/**
 * Reads the account-connect result the callback route
 * (app/api/channels/[provider]/connect/callback/) appends to the redirect,
 * so the Channels panel can show a success/error banner after OAuth.
 */
function readConnectResult(
  params: Record<string, string | string[] | undefined>,
): ChannelConnectResult | null {
  const connect = firstParam(params.connect);

  if (connect === "connected") {
    return { status: "connected", reason: null };
  }
  if (connect === "error") {
    return { status: "error", reason: firstParam(params.reason) };
  }

  return null;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const sectionParam = firstParam(params[QUERY_KEYS.section]);
  const sectionId: SettingsSectionId =
    sectionParam && isSettingsSectionId(sectionParam) ? sectionParam : "channels";
  const isDetail = sectionParam !== null;
  const section = SETTINGS_SECTIONS.find((entry) => entry.id === sectionId);
  const channels =
    sectionId === "channels" ? await loadChannelsSectionData() : null;
  const connectResult =
    sectionId === "channels" ? readConnectResult(params) : null;

  return (
    <div className={styles.panes} data-detail={isDetail}>
      {/* На десктопе список разделов скрыт — его дублирует расхлоп в меню. */}
      <section className={`${styles.paneList} ${setStyles.sectionList}`}>
        <div className={styles.paneHead}>
          <h2>Настройки</h2>
          <span className={styles.paneSubtitle}>
            workspace {getWorkspace().name}
          </span>
        </div>
        <div className={styles.list}>
          {SETTINGS_SECTIONS.map((entry) => (
            <Link
              key={entry.id}
              className={setStyles.sectionRow}
              data-active={entry.id === sectionId}
              href={buildHref(PATHNAME, { [QUERY_KEYS.section]: entry.id })}
            >
              <span className={setStyles.sectionIcon}>
                <SettingsIcon />
              </span>
              <span className={setStyles.sectionBody}>
                <b>{entry.title}</b>
                <span>{entry.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.paneDetail}>
        <div className={styles.threadHead}>
          <Link className={styles.backButton} href={PATHNAME} aria-label="Назад">
            <BackIcon />
          </Link>
          <div className={styles.threadWho}>
            <b>{section?.title}</b>
          </div>
        </div>
        <div className={setStyles.pane}>
          <div className={setStyles.inner}>
            <SectionDetail
              sectionId={sectionId}
              channels={channels}
              connectResult={connectResult}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionDetail({
  sectionId,
  channels,
  connectResult,
}: {
  sectionId: SettingsSectionId;
  channels: ChannelConnectionListItem[] | null;
  connectResult: ChannelConnectResult | null;
}) {
  switch (sectionId) {
    case "channels":
      return (
        <ChannelsSection channels={channels ?? []} connectResult={connectResult} />
      );
    case "categories":
      return <CategoriesSection />;
    case "ai":
      return <AiSection />;
    case "team":
      return <TeamSection />;
    case "notifications":
      return <NotificationsSection />;
    case "privacy":
      return <PrivacySection />;
  }
}

function ChannelsSection({
  channels,
  connectResult,
}: {
  channels: ChannelConnectionListItem[];
  connectResult: ChannelConnectResult | null;
}) {
  return (
    <>
      <p className={setStyles.description}>
        В рабочем пространстве можно подключить по одному каналу каждой
        платформы. Имя подключения видно в списках, тредах и меню.
      </p>
      <ChannelsPanel
        channels={channels}
        supportedPlatforms={SUPPORTED_CHANNEL_PLATFORMS}
        connectResult={connectResult}
      />
    </>
  );
}

function CategoriesSection() {
  const categories = getSettingsCategories();

  return (
    <>
      <p className={setStyles.description}>
        Проверка идёт сверху вниз, первая подходящая категория побеждает.
        «По умолчанию» всегда последняя и не удаляется.
      </p>
      <div className={uiStyles.card}>
        {categories.map((category) => (
          <div
            key={category.id}
            className={`${setStyles.categoryRow} ${
              category.isDefault ? setStyles.categoryDefault : ""
            }`}
          >
            <span
              className={`${setStyles.grip} ${
                category.isDefault ? setStyles.gripHidden : ""
              }`}
            >
              <GripIcon />
            </span>
            <span className={`${setStyles.priority} ${uiStyles.num}`}>
              {category.isDefault ? <LockIcon /> : category.priorityLabel}
            </span>
            <div className={setStyles.categoryBody}>
              <b>
                <span
                  className={uiStyles.categoryDot}
                  style={{ background: `var(${category.colorVar})` }}
                  aria-hidden="true"
                />
                {category.name}
              </b>
              <div className={setStyles.categoryChips}>
                <span className={uiStyles.chip}>{category.scopeLabel}</span>
                {category.extraLabels.map((label) => (
                  <span key={label} className={uiStyles.chip}>
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <StubButton
              className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonGhost}`}
            >
              Изменить
            </StubButton>
          </div>
        ))}
      </div>
      <StubButton
        className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSelfStart}`}
      >
        + Новая категория
      </StubButton>
    </>
  );
}

function AiSection() {
  const aiSettings = getAiSettings();

  return (
    <>
      <div className={`${uiStyles.card} ${uiStyles.cardStack}`}>
        <div className={uiStyles.field}>
          <label htmlFor="ai-tone">Тон ответов</label>
          <select id="ai-tone" defaultValue={aiSettings.tone}>
            {AI_SETTINGS_OPTIONS.tones.map((tone) => (
              <option key={tone}>{tone}</option>
            ))}
          </select>
        </div>
        <div className={uiStyles.field}>
          <label htmlFor="ai-language">Язык ответов</label>
          <select id="ai-language" defaultValue={aiSettings.language}>
            {AI_SETTINGS_OPTIONS.languages.map((language) => (
              <option key={language}>{language}</option>
            ))}
          </select>
        </div>
        <div className={uiStyles.field}>
          <label htmlFor="ai-signature">Подпись</label>
          <input
            id="ai-signature"
            type="text"
            defaultValue={aiSettings.signature}
          />
        </div>
        <div className={uiStyles.field}>
          <label htmlFor="ai-model">Модель</label>
          <select id="ai-model" defaultValue={aiSettings.model}>
            {AI_SETTINGS_OPTIONS.models.map((model) => (
              <option key={model}>{model}</option>
            ))}
          </select>
        </div>
        <div className={uiStyles.field}>
          <label>Дебаунс для мессенджеров</label>
          <div>{aiSettings.debounce_seconds} секунд паузы перед генерацией</div>
        </div>
      </div>

      <div className={uiStyles.card}>
        <h3>Авто-генерация черновиков</h3>
        <div className={setStyles.toggleRow}>
          <div className={setStyles.toggleLabel}>
            Для сообщений
            <span>черновик на каждую пачку после дебаунса</span>
          </div>
          <StubButton
            className={uiStyles.switch}
            role="switch"
            aria-checked={aiSettings.auto_draft_dm}
            aria-label="Авто-генерация для сообщений"
          />
        </div>
        <div className={setStyles.toggleRow}>
          <div className={setStyles.toggleLabel}>
            Для комментариев
            <span>черновик на каждый комментарий</span>
          </div>
          <StubButton
            className={uiStyles.switch}
            role="switch"
            aria-checked={aiSettings.auto_draft_comments}
            aria-label="Авто-генерация для комментариев"
          />
        </div>
      </div>
    </>
  );
}

function TeamSection() {
  const team = getSettingsTeam();

  return (
    <>
      <div className={uiStyles.card}>
        {team.map((row) => (
          <div key={row.id} className={setStyles.connectionRow}>
            {row.avatar ? (
              <Avatar avatar={row.avatar} size="sm" />
            ) : (
              <span
                className={`${uiStyles.avatar} ${uiStyles.avatarSm} ${setStyles.pendingAvatar}`}
                aria-hidden="true"
              >
                ?
              </span>
            )}
            <div className={setStyles.connectionBody}>
              <b>{row.name}</b>
              <span>{row.statusLine}</span>
            </div>
            {row.removable ? (
              <StubButton
                className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonGhost}`}
              >
                {row.removeLabel}
              </StubButton>
            ) : null}
          </div>
        ))}
      </div>
      <StubButton
        className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSelfStart}`}
      >
        + Пригласить
      </StubButton>
    </>
  );
}

function NotificationsSection() {
  const settings = getNotificationSettings();

  return (
    <div className={uiStyles.card}>
      <h3>Частота push-уведомлений</h3>
      <div className={uiStyles.radioRow}>
        <span
          className={uiStyles.radio}
          data-checked={settings.mode === "instant"}
          aria-hidden="true"
        />
        На каждое входящее
      </div>
      <div className={uiStyles.radioRow}>
        <span
          className={uiStyles.radio}
          data-checked={settings.mode === "digest"}
          aria-hidden="true"
        />
        Дайджест — раз в {settings.digest_interval_minutes} минут
      </div>
    </div>
  );
}

function PrivacySection() {
  return (
    <>
      <p className={setStyles.description}>
        GDPR: экспорт и удаление данных workspace. Удаление стирает всё каскадно.
      </p>
      <div className={`${uiStyles.card} ${uiStyles.cardRow}`}>
        <StubButton
          className={`${uiStyles.button} ${uiStyles.buttonSecondary}`}
        >
          Экспортировать данные
        </StubButton>
        <StubButton
          className={`${uiStyles.button} ${uiStyles.buttonSecondary} ${uiStyles.buttonDanger}`}
        >
          Удалить workspace…
        </StubButton>
      </div>
    </>
  );
}
