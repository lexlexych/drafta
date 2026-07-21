---
id: T-08
epic: E-002
title: "Подключение Telegram и WhatsApp (специфичные connect-флоу Zernio)"
type: dev
status: todo
depends_on: [T-02, T-04]
created: 2026-07-21
updated: 2026-07-21
---

# T-08. Подключение Telegram и WhatsApp (специфичные connect-флоу Zernio)

## Цель

В разделе «Настройки → Каналы» пользователь может подключить **Telegram** и **WhatsApp**
из интерфейса drafta, не открывая дашборд Zernio. Эти две платформы у Zernio **не
следуют** обычному OAuth-redirect-флоу (который уже работает для Facebook/Instagram —
см. ниже «Что уже сделано»): у Telegram — флоу с кодом доступа и опросом статуса, у
WhatsApp — OAuth Meta Embedded Signup с последующим **выбором номера телефона** (или
headless-подключение по Meta-креденшелам). Тикет добавляет поддержку обоих флоу с
сохранением инварианта резолва входящих вебхуков по `(provider, external_id)`.

## Контекст

### Что уже сделано (база, на которую опираемся)

OAuth-подключение каналов уже реализовано (PR #2 «Align channel connect flow with the
real Zernio REST API» + PR #3, влиты в `main`). Ключевые файлы:

- `lib/channels/zernio/api.ts` — серверный REST-клиент Zernio (Bearer `ZERNIO_API_KEY`):
  `createZernioProfile` (`POST /v1/profiles` → `profile._id`),
  `getZernioConnectAuthUrl` (`GET /v1/connect/{platform}` → `authUrl`).
- `lib/channels/zernio/adapter.ts` — `getConnectUrl(input)` async: обеспечивает профиль
  workspace, зовёт connect-эндпоинт, возвращает `{ url, providerProfileId }`;
  `parseConnectCallback(query)` → `{ externalAccountId, platform }`.
- `lib/channels/types.ts` — контракт адаптера (`GetConnectUrlInput`/`GetConnectUrlResult`,
  `parseConnectCallback`).
- `lib/channels/connect-state.ts` — подписанный `state` в httpOnly-cookie + nonce (`?cn=`)
  в `redirect_url` (защита от CSRF; Zernio наш `state` не round-trip'ит).
- `app/(app)/(shell)/settings/channels/actions.ts` — `startChannelConnectionAction`
  (server action): резолв workspace, профиль (`lib/db/channel-provider-profile.ts`),
  `getConnectUrl`, cookie со `state`, возврат `{ url }`; клиент делает
  `window.location.assign(url)`.
- `app/api/channels/[provider]/connect/callback/route.ts` — callback: проверка cookie-state
  + nonce, `parseConnectCallback`, `createChannelConnection`, редирект на
  `/settings?section=channels&connect=connected|error`.
- `app/(app)/(shell)/settings/channels/channels-panel.tsx` — UI формы «Подключить».
- `lib/db/channel-provider-profile.ts` — профиль Zernio на workspace в
  `workspaces.settings.providerProfiles.zernio` (admin-клиент).
- `lib/db/channel-connections.ts` — `createChannelConnection({ provider, platform, externalId, name })`.

**Инвариант (нельзя ломать):** входящие вебхуки резолвят подключение по
`(provider, external_id)` — `lib/webhooks/process-event.ts:32-38`, где
`external_id == account.id` из `lib/channels/zernio/parse.ts`. Значит `external_id`,
записанный при подключении Telegram/WhatsApp, **обязан совпадать** с тем ID аккаунта,
который Zernio присылает в вебхуках. Перед реализацией **проверить по реальному вебхуку
или фикстуре**, какое именно поле Zernio шлёт как `account.id` для telegram/whatsapp
(кандидаты: Zernio SocialAccount `_id` из ответа connect — см. ниже).

### Обязательно прочитать

- [5. Слой абстракции каналов, «Подключение аккаунта (OAuth)» и «Дисциплина»](../../architecture/05-channels.md#подключение-аккаунта-oauth)
- [6. Модель данных, channel_connections + workspaces.settings.providerProfiles](../../architecture/06-data-model.md#channel_connections)
- [13. Окружения, секреты](../../architecture/13-environments-secrets.md) — `ZERNIO_API_KEY`, `ZERNIO_API_BASE_URL`, `CHANNEL_CONNECT_STATE_SECRET`
- [14. Правила вайбкодинга](../../architecture/14-vibecoding-rules.md) — **правило 4**: весь Zernio-специфичный код только в `lib/channels/zernio/`; UI/ядро видят только нормализованные типы/методы адаптера.

### Документация Zernio (первоисточники)

- Гайд по подключению аккаунтов (Telegram code-flow, WhatsApp): <https://docs.zernio.com/guides/connecting-accounts>
- Обзор платформ: <https://docs.zernio.com/platforms>
- WhatsApp — подключение и настройка: <https://docs.zernio.com/platforms/whatsapp/connection>
- Полная OpenAPI-спека (первоисточник форм запросов/ответов): <https://docs.zernio.com/api/openapi>
- Полные доки одним файлом (для агентов): <https://docs.zernio.com/llms-full.txt>
- Per-platform OpenAPI (напр. telegram.yaml): <https://github.com/zernio-dev/openapi-specs>

> [!warning] Не гадать про формы запросов/ответов
> Все точные пути, поля запроса и **вложенность полей ответа** брать из OpenAPI-спеки
> (первая ошибка в этой области стоила отдельного багфикса: `POST /v1/profiles` кладёт id
> в `profile._id`, а не на верхний уровень). SDK-примеры в доках используют обёртку
> `const { data } = ...` — это обёртка SDK, **не** тело HTTP-ответа, которое видит наш `fetch`.

---

## Спецификация флоу (по OpenAPI Zernio)

Все эндпоинты — под `ZERNIO_API_BASE_URL` (`https://zernio.com/api/v1`), аутентификация
`Authorization: Bearer <ZERNIO_API_KEY>`. Профиль (`profileId`) — уже хранимый на workspace.

### A. Telegram — флоу с кодом доступа (не OAuth)

Telegram у Zernio подключается через бота-администратора канала/группы. `getConnectUrl`
здесь **не применяется** — используются выделенные эндпоинты `/v1/connect/telegram`.

1. **Сгенерировать код** — `GET /v1/connect/telegram?profileId=<id>` →
   `200 { code, expiresAt, expiresIn, botUsername, instructions[] }`
   (пример: `code: "ZRN-ABC123"`, `botUsername: "LateScheduleBot"`, `expiresIn: 900`).
2. Показать пользователю `botUsername`, `code` и `instructions`: добавить бота
   администратором в канал/группу, открыть личный чат с ботом, отправить
   `<code> @yourchannel`.
3. **Опрашивать статус** — `PATCH /v1/connect/telegram?code=<code>` каждые ~3 сек →
   `200` (`oneOf`):
   - `{ status: "pending", expiresAt, expiresIn }`
   - `{ status: "connected", chatId, chatTitle, chatType, account: { _id, platform, username, displayName } }`
   - `{ status: "expired", message }`
4. На `connected` — создать `channel_connections`: `platform: "telegram"`,
   `external_id = account._id` (**проверить против вебхука**, см. инвариант), `name` из формы.

Альтернатива (если бот уже админ и известен chatId) —
`POST /v1/connect/telegram { chatId, profileId }` → `200 { account: { _id, ... } }`.
Код-флоу выше предпочтителен для UX.

Коды ошибок: `400` (нет/битый profileId, бот не админ, нет доступа к чату), `401`, `403`,
`404`, `500`. Код живёт 15 минут → на `expired` дать кнопку «Сгенерировать заново».

### B. WhatsApp — OAuth Embedded Signup + выбор номера

WhatsApp Business подключается через Meta Embedded Signup (OAuth) с последующим выбором
номера телефона внутри WABA. Три пути:

**B1. Стандартный режим (переиспользует существующий OAuth-флоу) — рекомендуется как первый.**
- `getConnectUrl` (уже есть) зовёт `GET /v1/connect/whatsapp?profileId&redirect_url` → `authUrl`.
- В стандартном режиме (без `headless=true`) **Zernio сам хостит выбор номера** и редиректит
  обратно на наш callback с `connected=whatsapp&accountId=…` — это уже обрабатывает текущий
  callback-роут. Одиночный номер в WABA авто-завершается на стороне Zernio.
- **Действие:** проверить, что для нашего Zernio-аккаунта WhatsApp Embedded Signup включён
  (Meta-конфигурация на стороне Zernio — см. предусловия), прогнать флоу целиком.

**B2. Headless-режим (свой UI выбора номера) — если нужен white-label.**
- В `redirect_url` добавить `headless=true`. При нескольких номерах в WABA callback придёт с
  `step=select_phone_number&profileId&tempToken` вместо `accountId`.
- `GET /v1/connect/whatsapp/select-phone-number?profileId&tempToken` →
  `200 { phoneNumbers: [{ id, display_phone_number, verified_name, quality_rating, wabaId, wabaName, … }] }`
  (поля номера — snake_case Meta Cloud API как есть; `wabaId`/`wabaName` — обогащение Zernio).
- Пользователь выбирает → `POST /v1/connect/whatsapp/select-phone-number`
  `{ profileId, phoneNumberId, wabaId, tempToken }` → биндит номер, создаёт SocialAccount
  (возвращает данные аккаунта, включая `accountId`).
- Одиночный номер авто-завершается на callback (как B1).

**B3. Headless по креденшелам (без браузера) — как fallback/для «продвинутых».**
- `POST /v1/connect/whatsapp/credentials`
  `{ profileId, accessToken, wabaId, phoneNumberId }` →
  `200 { account: { accountId, platform, username, displayName, isActive, selectedPhoneNumber } }`.
- Требует, чтобы пользователь получил из Meta Business Suite: permanent System User access
  token (permissions `whatsapp_business_management`, `whatsapp_business_messaging`), WABA ID,
  Phone Number ID. Форма ввода этих трёх полей — опциональна (продвинутый режим).

Во всех путях `external_id` подключения = ID аккаунта, который Zernio шлёт в вебхуках
(**проверить**; кандидат — `accountId`/`account._id` из ответа).

### Предусловия и решения (зафиксировать до кода)

1. **WhatsApp Embedded Signup требует Meta-конфигурации на стороне Zernio** (Tech Provider).
   Подтвердить, что наш Zernio-аккаунт имеет WhatsApp включённым; Meta биллит WABA напрямую.
2. **Режим WhatsApp:** начать с **B1 (стандартный)**; переходить на B2/B3 только если нужен
   свой UI выбора номера или подключение без браузера.
3. **Поле `external_id`** для telegram и whatsapp — сверить с реальным вебхуком/фикстурой
   (инвариант резолва). При расхождении — поправить `lib/channels/zernio/parse.ts`/маппинг.
4. **Продуктовый вопрос по Telegram:** подключается **канал/группа** (бот-админ), а инбокс
   продукта — DM + комментарии. Уточнить у продукта, что именно попадает в инбокс от Telegram
   (сообщения канала/группы vs личные диалоги бота) и как это ложится на `kind` диалога.

---

## Шаги реализации

1. **Zernio API-клиент** — `lib/channels/zernio/api.ts` (чистые функции, мок `fetch`, поля по
   OpenAPI):
   - `generateTelegramCode(config, { profileId })` → `{ code, botUsername, instructions, expiresIn }`.
   - `pollTelegramConnect(config, { code })` → `{ status, account?, chatId?, … }`.
   - `connectTelegramDirect(config, { chatId, profileId })` → `{ account }` (опционально).
   - `listWhatsAppPhoneNumbers(config, { profileId, tempToken })` → `{ phoneNumbers }`.
   - `selectWhatsAppPhoneNumber(config, { profileId, phoneNumberId, wabaId, tempToken })` → `{ account }`.
   - `connectWhatsAppCredentials(config, { profileId, accessToken, wabaId, phoneNumberId })` → `{ account }` (B3).
2. **Контракт адаптера** — расширить под не-OAuth-флоу, не ломая правило 4. Рекомендация:
   адаптер объявляет «вид подключения» на платформу, напр.
   `connectKind(platform): "oauth-redirect" | "telegram-code" | "whatsapp"`, и предоставляет
   соответствующие методы (Telegram: `startTelegramConnect`/`pollTelegramConnect`; WhatsApp:
   переиспользует `getConnectUrl`, плюс `listWhatsAppPhoneNumbers`/`selectWhatsAppPhoneNumber`).
   UI выбирает сценарий по `connectKind`, провайдер-специфика — внутри `lib/channels/zernio/`.
3. **UI Telegram** (`channels-panel.tsx` + новый под-компонент): после «Подключить (Telegram)» —
   server action зовёт `generateTelegramCode`, экран показывает `botUsername`, `code`,
   `instructions`; клиент опрашивает статус (polling через server action/route, интервал ~3 с);
   на `connected` — `createChannelConnection`, баннер успеха; на `expired` — «сгенерировать заново».
   Никакого `sleep` в вебхук-путях; поллинг — на клиенте.
4. **WhatsApp**: реализовать B1 (проверить сквозной прогон). Для B2 — обработать в callback-роуте
   ветку `step=select_phone_number` (сохранить `tempToken`/`profileId` в подписанную cookie/`state`,
   отрисовать выбор номера, вызвать select). B3 — опциональная форма креденшелов.
5. **Провайдер-профиль** — переиспользовать `lib/db/channel-provider-profile.ts` (профиль на workspace).
6. **Инвариант external_id** — записывать то поле, что приходит в вебхуках; подтвердить фикстурой.
7. **Тесты** — мок `fetch` для новых api-функций (формы по OpenAPI); юнит на Telegram-поллинг
   (pending → connected → создание подключения); ветка callback `step=select_phone_number`;
   UI-тест панели для Telegram-экрана.
8. **Документация** — `05-channels.md`: описать, что connect-флоу зависит от платформы
   (oauth-redirect / telegram-code / whatsapp-select); при новых env — `13-environments-secrets.md`.

## Критерии приёмки

- Из «Настройки → Каналы» пользователь подключает **Telegram**-канал/группу целиком в UI drafta
  (код + инструкции + автоопрос статуса), не заходя в дашборд Zernio; создаётся строка
  `channel_connections` (`provider=zernio`, `platform=telegram`), и входящий Telegram-вебхук
  резолвится в это подключение.
- Из того же экрана пользователь подключает **WhatsApp**-номер (путь B1 как минимум); создаётся
  подключение (`platform=whatsapp`), входящий вебхук резолвится.
- `external_id` подключений совпадает с ID аккаунта из вебхуков (подтверждено фикстурой/живым payload).
- Весь Zernio-специфичный код — в `lib/channels/zernio/` (правило 4).
- `npm run lint`, `npm test`, `next build` — зелёные; добавлены тесты на новые api-функции и флоу.

## Definition of Done

- Реализованы флоу Telegram (код-флоу) и WhatsApp (B1; B2/B3 — по решению из «Предусловий»).
- Открытые вопросы из «Предусловия и решения» закрыты (режим WhatsApp, поле `external_id`,
  продуктовый вопрос по Telegram) — с отметкой в отчёте разработчика.
- Smoke: сквозной прогон обоих подключений на реальном Zernio-аккаунте (dev-профиль) с
  проверкой создания строки и резолва входящего вебхука; при отсутствии живого доступа —
  зафиксировать как оставшийся ручной шаг (аналогично T-07).
- Тесты и доки обновлены; изменения — отдельной веткой от актуального `main` и новым PR
  (см. AGENTS.md, «смёрженный PR — законченный»).

## Открытые вопросы

1. Режим WhatsApp: стандартный (B1) достаточно, или нужен white-label headless (B2)/креденшелы (B3)?
2. Точное поле `external_id` для telegram/whatsapp (сверить с вебхуком Zernio).
3. Telegram: что именно из канала/группы попадает в DM-инбокс и как это отражается в `kind`.
4. Предоставлен ли доступ к Zernio-аккаунту с включённым WhatsApp Embedded Signup (Meta Tech Provider).
