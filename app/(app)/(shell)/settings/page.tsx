import Link from "next/link";

import {
  SETTINGS_SECTIONS,
  getNotificationSettings,
  getSettingsTeam,
  getWorkspace,
  isSettingsSectionId,
  type SettingsSectionId,
} from "@/lib/mock";
import { getAiModelOptions, type AiModelOption } from "@/lib/ai/config";
import {
  SUPPORTED_CHANNEL_PLATFORMS,
  listChannelConnections,
} from "@/lib/db/channel-connections";
import { listCategories, type CategoryRow } from "@/lib/db/categories";
import {
  getWorkspaceAiSettings,
  type AiSettingsRow,
} from "@/lib/db/ai-settings";
import {
  listKnowledgeFiles,
  type KnowledgeFileRow,
} from "@/lib/db/knowledge-base";
import { createServerSupabaseClient } from "@/lib/db/server";
import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

import { Avatar } from "../_components/avatar";
import { BackIcon, SettingsIcon } from "../_components/icons";
import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import { StubButton } from "../_components/stub";
import {
  ChannelsPanel,
  type ChannelConnectionListItem,
  type ChannelConnectResult,
} from "./channels/channels-panel";
import {
  KnowledgeBasePanel,
  type KnowledgeFileListItem,
} from "./knowledge/knowledge-base-panel";
import {
  CategoriesPanel,
  type CategoryChannelOption,
} from "./categories/categories-panel";
import { AiSettingsForm } from "./ai/ai-settings-form";
import setStyles from "./settings.module.css";
import styles from "../_components/panes.module.css";
import uiStyles from "../_components/ui.module.css";

const PATHNAME = "/settings";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type AiSectionData = {
  settings: AiSettingsRow;
  modelOptions: AiModelOption[];
};

/**
 * Loads the current workspace's `channel_connections` for the Channels
 * section (T-04) — real data, unlike the rest of this page (still mock,
 * T-07 UI-каркас, replaced section by section in later epics). Only called
 * when the Channels section is actually being rendered, so the other
 * sections are loaded independently so opening one settings panel does not
 * query data owned by another panel.
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

async function loadKnowledgeSectionData(): Promise<KnowledgeFileListItem[]> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return [];
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return [];
  }

  const supabase = await createServerSupabaseClient();
  const rows = await listKnowledgeFiles(supabase, workspace.id);

  return rows.map(
    (row: KnowledgeFileRow): KnowledgeFileListItem => ({
      id: row.id,
      name: row.name,
      content: row.content,
      sort_order: row.sort_order,
      is_enabled: row.is_enabled,
      updated_at: row.updated_at,
    }),
  );
}

async function loadCategoriesSectionData(): Promise<{
  categories: CategoryRow[];
  channels: CategoryChannelOption[];
}> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { categories: [], channels: [] };
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return { categories: [], channels: [] };
  }

  const supabase = await createServerSupabaseClient();
  const [categories, channelRows] = await Promise.all([
    listCategories(supabase, workspace.id),
    listChannelConnections(supabase, workspace.id),
  ]);

  return {
    categories,
    channels: channelRows.map((channel) => ({
      id: channel.id,
      name: channel.name,
    })),
  };
}

async function loadAiSectionData(): Promise<AiSectionData | null> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return null;
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return null;
  }

  const supabase = await createServerSupabaseClient();

  return {
    settings: await getWorkspaceAiSettings(supabase, workspace.id),
    modelOptions: getAiModelOptions(),
  };
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
  const knowledgeFiles =
    sectionId === "knowledge" ? await loadKnowledgeSectionData() : null;
  const categoriesData =
    sectionId === "categories" ? await loadCategoriesSectionData() : null;
  const aiData = sectionId === "ai" ? await loadAiSectionData() : null;
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
              aiData={aiData}
              categoriesData={categoriesData}
              channels={channels}
              connectResult={connectResult}
              knowledgeFiles={knowledgeFiles}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionDetail({
  sectionId,
  aiData,
  categoriesData,
  channels,
  connectResult,
  knowledgeFiles,
}: {
  sectionId: SettingsSectionId;
  aiData: AiSectionData | null;
  categoriesData: {
    categories: CategoryRow[];
    channels: CategoryChannelOption[];
  } | null;
  channels: ChannelConnectionListItem[] | null;
  connectResult: ChannelConnectResult | null;
  knowledgeFiles: KnowledgeFileListItem[] | null;
}) {
  switch (sectionId) {
    case "channels":
      return (
        <ChannelsSection channels={channels ?? []} connectResult={connectResult} />
      );
    case "categories":
      return <CategoriesSection data={categoriesData} />;
    case "ai":
      return <AiSection data={aiData} />;
    case "knowledge":
      return (
        <>
          <p className={setStyles.description}>
            Активные файлы добавляются в системный промпт в указанном порядке.
            При превышении бюджета токенов часть файлов не попадёт в контекст.
          </p>
          <KnowledgeBasePanel files={knowledgeFiles ?? []} />
        </>
      );
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

function CategoriesSection({
  data,
}: {
  data: {
    categories: CategoryRow[];
    channels: CategoryChannelOption[];
  } | null;
}) {
  return (
    <>
      <p className={setStyles.description}>
        Проверка идёт сверху вниз, первая подходящая категория побеждает.
        «По умолчанию» всегда последняя и не удаляется.
      </p>
      <CategoriesPanel
        key={(data?.categories ?? [])
          .map(
            (category) =>
              `${category.id}:${category.priority}:${category.updated_at}`,
          )
          .join("|")}
        categories={data?.categories ?? []}
        channels={data?.channels ?? []}
      />
    </>
  );
}

function AiSection({ data }: { data: AiSectionData | null }) {
  if (!data) {
    return <p className={setStyles.formError}>AI-настройки недоступны.</p>;
  }

  return (
    <AiSettingsForm
      initialValue={{
        tone: data.settings.tone,
        language: data.settings.language,
        signature: data.settings.signature,
        debounceSeconds: data.settings.debounce_seconds,
        model: data.settings.model,
        autoGenerateDm: data.settings.auto_generate_dm,
        autoGenerateComments: data.settings.auto_generate_comments,
      }}
      modelOptions={data.modelOptions}
    />
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
