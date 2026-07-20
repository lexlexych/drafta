import Link from "next/link";

import {
  AI_SETTINGS_OPTIONS,
  SETTINGS_SECTIONS,
  getAiSettings,
  getNotificationSettings,
  getSettingsCategories,
  getSettingsChannels,
  getSettingsTeam,
  getWorkspace,
  isSettingsSectionId,
  type SettingsSectionId,
} from "@/lib/mock";

import { Avatar } from "../_components/avatar";
import { PlatformDot } from "../_components/chips";
import { BackIcon, GripIcon, LockIcon, SettingsIcon } from "../_components/icons";
import { QUERY_KEYS, buildHref, firstParam } from "../_components/navigation";
import { StubButton } from "../_components/stub";
import setStyles from "./settings.module.css";
import styles from "../_components/panes.module.css";
import uiStyles from "../_components/ui.module.css";

const PATHNAME = "/settings";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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
            <SectionDetail sectionId={sectionId} />
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionDetail({ sectionId }: { sectionId: SettingsSectionId }) {
  switch (sectionId) {
    case "channels":
      return <ChannelsSection />;
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

function ChannelsSection() {
  const channels = getSettingsChannels();

  return (
    <>
      <p className={setStyles.description}>
        Каналов одной платформы может быть несколько — каждому подключению
        задаётся своё имя. Имя видно в списках, тредах и меню.
      </p>
      <div className={uiStyles.card}>
        {channels.map((channel) => (
          <div key={channel.id} className={setStyles.connectionRow}>
            <PlatformDot platform={channel.platform} />
            <div className={setStyles.connectionBody}>
              <b>{channel.name}</b>
              <span>{channel.statusLine}</span>
            </div>
            <StubButton
              className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonSecondary}`}
            >
              Переименовать
            </StubButton>
            <StubButton
              className={`${uiStyles.button} ${uiStyles.buttonSmall} ${uiStyles.buttonGhost}`}
            >
              Отключить
            </StubButton>
          </div>
        ))}
      </div>
      <StubButton
        className={`${uiStyles.button} ${uiStyles.buttonPrimary} ${uiStyles.buttonSelfStart}`}
      >
        + Подключить канал
      </StubButton>
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
