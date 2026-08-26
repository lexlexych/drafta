import Link from "next/link";

import {
  SETTINGS_SECTIONS,
  getSettingsTeam,
  isSettingsSectionId,
  type SettingsSectionId,
} from "@/lib/mock";
import { getAiModelOptions, type AiModelOption } from "@/lib/ai/config";
import { listChannelConnections } from "@/lib/db/channel-connections";
import {
  getWorkspaceAiSettings,
  type AiSettingsRow,
} from "@/lib/db/ai-settings";
import {
  getNotificationSettings,
  type NotificationSettingsView,
} from "@/lib/db/notification-settings";
import {
  listKnowledgeFiles,
  type KnowledgeFileRow,
} from "@/lib/db/knowledge-base";
import {
  listReplyTemplates,
  type ReplyTemplateRow,
} from "@/lib/db/reply-templates";
import { getWorkspaceLanguage } from "@/lib/db/workspace-language";
import { createServerSupabaseClient } from "@/lib/db/server";
import type { WorkspaceLanguage } from "@/lib/i18n/languages";
import {
  defaultTemplateLanguage,
  type TemplateLanguage,
} from "@/lib/i18n/template-languages";
import {
  getAuthenticatedUser,
  getCurrentWorkspace,
  listUserWorkspaces,
} from "@/lib/db/workspace";

import { LinkActivity } from "../_components/activity";
import { Avatar } from "../_components/avatar";
import {
  AccountIcon,
  BackIcon,
  BellIcon,
  BookIcon,
  DeviceIcon,
  PlugIcon,
  ShieldIcon,
  SparkIcon,
  TeamIcon,
  TemplateIcon,
} from "../_components/icons";
import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import { StubButton } from "../_components/stub";
import {
  AccountPanel,
  type AccountWorkspaceOption,
} from "./account/account-panel";
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
  ReplyTemplatesPanel,
  type ReplyTemplateListItem,
} from "./templates/templates-panel";
import { AiSettingsForm } from "./ai/ai-settings-form";
import { AppInstallPanel } from "./app/app-install-panel";
import { NotificationsForm } from "./notifications/notifications-form";
import setStyles from "./settings.module.css";
import styles from "../_components/panes.module.css";
import uiStyles from "../_components/ui.module.css";

const PATHNAME = "/settings";

/** Свой значок у каждого раздела — строки списка различимы с одного взгляда. */
const SECTION_ICONS: Record<SettingsSectionId, typeof PlugIcon> = {
  channels: PlugIcon,
  ai: SparkIcon,
  knowledge: BookIcon,
  templates: TemplateIcon,
  team: TeamIcon,
  notifications: BellIcon,
  app: DeviceIcon,
  privacy: ShieldIcon,
  account: AccountIcon,
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type AccountSectionData = {
  userName: string;
  userRole: string;
  workspaces: AccountWorkspaceOption[];
  currentWorkspaceId: string;
  language: WorkspaceLanguage;
  canManageLanguage: boolean;
};

type AiSectionData = {
  settings: AiSettingsRow;
  modelOptions: AiModelOption[];
};

type TemplatesSectionData = {
  templates: ReplyTemplateListItem[];
  /** Язык из «Аккаунта» — первая вкладка нового шаблона. */
  workspaceLanguage: TemplateLanguage;
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

/**
 * Раздел «Шаблоны ответов»: сами шаблоны плюс язык workspace — с него
 * начинается набор языков у нового шаблона.
 */
async function loadTemplatesSectionData(): Promise<TemplatesSectionData | null> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return null;
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return null;
  }

  const supabase = await createServerSupabaseClient();
  const rows = await listReplyTemplates(supabase, workspace.id);

  return {
    templates: rows.map(
      (row: ReplyTemplateRow): ReplyTemplateListItem => ({
        id: row.id,
        name: row.name,
        bodies: row.bodies,
        isEnabledForMessages: row.is_enabled_for_messages,
        isEnabledForComments: row.is_enabled_for_comments,
        updated_at: row.updated_at,
      }),
    ),
    workspaceLanguage: defaultTemplateLanguage(
      await getWorkspaceLanguage(supabase, workspace.id),
    ),
  };
}

async function loadNotificationsSectionData(): Promise<NotificationSettingsView | null> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return null;
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return null;
  }

  const supabase = await createServerSupabaseClient();

  return getNotificationSettings(supabase, workspace.id, user.id);
}

/**
 * Раздел «Аккаунт»: те же данные, что уходят в меню пользователя левого меню
 * (список workspace'ов пользователя и текущий workspace), плюс язык
 * приложения из `workspaces.settings.lang`.
 */
async function loadAccountSectionData(): Promise<AccountSectionData | null> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return null;
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    return null;
  }

  const workspaces = await listUserWorkspaces(user.id);
  const supabase = await createServerSupabaseClient();

  return {
    userName: user.email?.split("@")[0] ?? "Пользователь",
    userRole: workspace.role,
    workspaces: workspaces.map((entry) => ({
      id: entry.id,
      name: entry.name,
    })),
    currentWorkspaceId: workspace.id,
    language: await getWorkspaceLanguage(supabase, workspace.id),
    // Политика `workspaces_update_owner`: settings меняет только владелец.
    canManageLanguage: workspace.role === "owner",
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
  const templatesData =
    sectionId === "templates" ? await loadTemplatesSectionData() : null;
  const aiData = sectionId === "ai" ? await loadAiSectionData() : null;
  const notificationsData =
    sectionId === "notifications" ? await loadNotificationsSectionData() : null;
  const accountData =
    sectionId === "account" ? await loadAccountSectionData() : null;
  const connectResult =
    sectionId === "channels" ? readConnectResult(params) : null;

  return (
    <div className={styles.panes} data-detail={isDetail}>
      <section className={styles.paneList}>
        <div className={styles.paneHead}>
          <h2>Настройки</h2>
        </div>
        <div className={styles.list}>
          {SETTINGS_SECTIONS.map((entry) => {
            const Icon = SECTION_ICONS[entry.id];

            return (
              <Link
                key={entry.id}
                className={setStyles.sectionRow}
                data-active={entry.id === sectionId}
                href={buildHref(PATHNAME, { [QUERY_KEYS.section]: entry.id })}
              >
                <span className={setStyles.sectionIcon}>
                  <Icon size={17} />
                </span>
                <span className={setStyles.sectionBody}>
                  <b>{entry.title}</b>
                  <span>{entry.description}</span>
                </span>
                <LinkActivity label={`Открываем «${entry.title}»…`} />
              </Link>
            );
          })}
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
              accountData={accountData}
              aiData={aiData}
              notificationsData={notificationsData}
              channels={channels}
              connectResult={connectResult}
              knowledgeFiles={knowledgeFiles}
              templatesData={templatesData}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionDetail({
  sectionId,
  accountData,
  aiData,
  notificationsData,
  channels,
  connectResult,
  knowledgeFiles,
  templatesData,
}: {
  sectionId: SettingsSectionId;
  accountData: AccountSectionData | null;
  aiData: AiSectionData | null;
  notificationsData: NotificationSettingsView | null;
  channels: ChannelConnectionListItem[] | null;
  connectResult: ChannelConnectResult | null;
  knowledgeFiles: KnowledgeFileListItem[] | null;
  templatesData: TemplatesSectionData | null;
}) {
  switch (sectionId) {
    case "channels":
      return (
        <ChannelsSection channels={channels ?? []} connectResult={connectResult} />
      );
    case "ai":
      return <AiSection data={aiData} />;
    case "knowledge":
      return (
        <>
          <p className={setStyles.description}>
            Каждая категория — это тема, по которой AI отвечает: название плюс
            текст, откуда берутся факты. Активные категории добавляются в
            системный промпт в указанном порядке; при превышении бюджета токенов
            часть из них не попадёт в контекст.
          </p>
          <KnowledgeBasePanel files={knowledgeFiles ?? []} />
        </>
      );
    case "templates":
      return <TemplatesSection data={templatesData} />;
    case "team":
      return <TeamSection />;
    case "notifications":
      return <NotificationsSection data={notificationsData} />;
    case "app":
      return <AppSection />;
    case "privacy":
      return <PrivacySection />;
    case "account":
      return <AccountSection data={accountData} />;
  }
}

function AccountSection({ data }: { data: AccountSectionData | null }) {
  if (!data) {
    return <p className={setStyles.formError}>Данные аккаунта недоступны.</p>;
  }

  return (
    <AccountPanel
      userName={data.userName}
      userRole={data.userRole}
      workspaces={data.workspaces}
      currentWorkspaceId={data.currentWorkspaceId}
      language={data.language}
      canManageLanguage={data.canManageLanguage}
    />
  );
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
        платформы. Имя канала подставляется из имени аккаунта и видно в
        списках, тредах и меню — переименовать его можно в любой момент.
      </p>
      <ChannelsPanel channels={channels} connectResult={connectResult} />
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
        systemPrompt: data.settings.system_prompt,
        commentSystemPrompt: data.settings.comment_system_prompt,
        model: data.settings.model,
      }}
      modelOptions={data.modelOptions}
    />
  );
}

function TemplatesSection({ data }: { data: TemplatesSectionData | null }) {
  if (!data) {
    return <p className={setStyles.formError}>Шаблоны недоступны.</p>;
  }

  return (
    <>
      <p className={setStyles.description}>
        Шаблон — готовый ответ, который оператор подставляет в поле одним
        кликом, без генерации. Значки в списке показывают, где шаблон
        предлагается: в переписке, под комментариями или и там, и там. Текст
        хранится на нескольких языках — оператор выбирает нужный при вставке.
      </p>
      <ReplyTemplatesPanel
        templates={data.templates}
        workspaceLanguage={data.workspaceLanguage}
      />
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

function NotificationsSection({
  data,
}: {
  data: NotificationSettingsView | null;
}) {
  if (!data) {
    return (
      <p className={setStyles.formError}>Настройки уведомлений недоступны.</p>
    );
  }

  return (
    <>
      <p className={setStyles.description}>
        Push приходят на устройства, где включены уведомления. В режиме
        «дайджест» вместо мгновенных push приходит сводка о новых входящих по
        заданному интервалу.
      </p>
      <NotificationsForm
        initialValue={{
          mode: data.mode,
          digestIntervalMinutes: data.digestIntervalMinutes,
        }}
      />
    </>
  );
}

function AppSection() {
  return (
    <>
      <p className={setStyles.description}>
        drafta — это PWA: приложение можно установить на устройство и открывать
        как обычное — в отдельном окне, с поддержкой push-уведомлений.
      </p>
      <AppInstallPanel />
    </>
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
