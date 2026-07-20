---
id: T-03
epic: E-002
title: "Вебхук-роут с идемпотентностью: пайплайн входящего"
type: dev
status: review
depends_on: [T-02]
created: 2026-07-19
updated: 2026-07-20
---

# T-03. Вебхук-роут с идемпотентностью: пайплайн входящего

## Цель

`POST /api/webhooks/zernio` принимает вебхук и за доли секунды идемпотентно
раскладывает его в БД по пайплайну §7.1: `webhook_events` (дубль → сразу 200) →
адаптер нормализует → upsert `contact_identity` (+`contact`), `conversation` →
insert `message` → эмиссия `interaction/received` (только ID) → 200.
Повторная доставка того же вебхука не создаёт дублей.

## Контекст

Обязательно прочитать перед выполнением:

- [7. Потоки данных, §6.1](../../architecture/07-data-flows.md#61-входящее-dm-или-комментарий) — пайплайн входящего дословно; **LLM в запросе не вызывается никогда**
- [6. Модель данных](../../architecture/06-data-model.md) — `webhook_events` (уникальность провайдер + внешний ID события), `contacts`/`contact_identities`, `conversations` (`kind`, `last_incoming_at`, счётчик непрочитанного), `messages` (уникальность conversation + внешний ID)
- [12. Структура репозитория](../../architecture/12-repo-structure.md) — `app/api/webhooks/[provider]/`
- [13. Окружения, секреты](../../architecture/13-environments-secrets.md#секреты-vercel-env) — `SUPABASE_SECRET_KEY` только в серверном коде
- [14. Правила вайбкодинга](../../architecture/14-vibecoding-rules.md) — правила 5, 6, 7

Существенные факты:

- T-01/T-02 дали реестр и адаптер Zernio; роут провайдер-агностичен —
  резолвит адаптер из реестра по `[provider]` из URL.
- У вебхука нет пользовательской сессии — используется серверный клиент Supabase
  с `SUPABASE_SECRET_KEY` (обходит RLS; только в серверном коде, правило 5).
- `channel_connection` резолвится по (провайдер, внешний ID аккаунта) из события;
  таблица заполняется в T-04/тестах — здесь достаточно сидов/вставок в тестах.
- **Открытый вопрос №2 эпика:** настройка Inngest — этап 2. Здесь создаётся только
  клиент (`lib/inngest/client.ts`) и эмиссия события fail-safe: ошибка отправки
  логируется, но не ломает обработку (сообщение уже в БД, ответ всё равно 200).
  `serve()`-роут и функции-обработчики в этом эпике не создаются.
- Авто-создание контакта: новая личность (платформа + внешний ID) создаёт новый
  `contact` с отображаемым именем из события ([§6, склейка](../../architecture/06-data-model.md#contact_identities) — ручная, этап 7).

## Шаги реализации

1. `app/api/webhooks/[provider]/route.ts` (POST):
   - резолв адаптера из реестра; неизвестный провайдер → 404;
   - `verifyWebhook` адаптером; невалидная подпись → 401, ничего не пишется;
   - insert в `webhook_events` (провайдер + внешний ID события, сырой payload);
     конфликт уникальности (дубль) → **сразу 200** без обработки.
2. Обработка нормализованных событий (`message.received`, `kind = dm`):
   - найти `channel_connection` по (провайдер, внешний ID аккаунта); нет или
     статус не активен → пометить `webhook_event` ошибкой, ответить 200;
   - upsert `contact_identity` по (workspace, платформа, внешний ID отправителя);
     новой личности — создать `contact` с именем из события;
   - upsert `conversation` (`kind = dm`) по (channel_connection, внешний ID диалога);
   - insert `message` (направление входящее, текст, метаданные вложений, автор —
     contact_identity, сырые метаданные, внешний ID); конфликт уникальности
     (conversation + внешний ID) → пропустить без ошибки;
   - обновить `conversations.last_incoming_at` и инкрементировать счётчик
     непрочитанного;
   - отметить `webhook_event` обработанным (или записать текст ошибки).
3. `lib/inngest/client.ts` + эмиссия `inngest.send("interaction/received", …)`
   с payload **строго только ID**: `messageId`, `conversationId`, `workspaceId`
   (правило 7). Эмиссия fail-safe (см. контекст).
4. Статусы доставки (`message.delivered/read/failed`), если адаптер их отдаёт, —
   обновление статуса существующего сообщения; неизвестные события помечаются
   в `webhook_events` и не роняют обработку.
5. Тесты (route handler вызывается напрямую с фикстурами из T-02, БД — локальный
   Supabase):
   - happy path: создаются contact, contact_identity, conversation, message;
     `last_incoming_at` обновлён;
   - идемпотентность: тот же payload дважды → одна запись в `webhook_events`
     обработана, message один;
   - два сообщения одного отправителя → один contact, одна conversation, два message;
   - невалидная подпись → 401 и пустые таблицы;
   - неизвестный внешний ID аккаунта → 200, `webhook_event` с ошибкой, message нет.

## Критерии приёмки

- [ ] Пайплайн повторяет §6.1 шаг в шаг; в роуте нет вызовов LLM и внешних отправок (правила 6, 8)
- [ ] Дубль вебхука по внешнему ID события → 200 без повторной обработки; дубль сообщения не создаётся
- [ ] Payload события Inngest содержит только `messageId`, `conversationId`, `workspaceId` — проверено тестом или явным типом (правило 7)
- [ ] Ошибка эмиссии Inngest-события не ломает обработку вебхука (fail-safe)
- [ ] Невалидная подпись → 401, в БД ничего не записано
- [ ] `SUPABASE_SECRET_KEY` используется только в серверных модулях
- [ ] Сырой payload сохраняется в `webhook_events` целиком (источник фикстур и replay)
- [ ] Все перечисленные в шаге 5 тесты написаны и проходят

## Definition of Done

```
supabase db reset   # чистая схема для интеграционных тестов
npm run lint
npm run build
npm test            # включая интеграционные тесты роута
```

Ревьюер прогоняет тесты и дополнительно отправляет фикстуру в роут дважды
(например, curl на локальном dev-сервере), проверяя идемпотентность по БД.

---

## 🔧 Отчёт разработчика

### Что сделано

Реализован пайплайн §6.1 целиком: `POST /api/webhooks/[provider]` резолвит
адаптер из реестра T-01, проверяет подпись, идемпотентно журналирует событие
в `webhook_events`, раскладывает `message.received` (`kind = dm`) в
contact/contact_identity/conversation/message, обновляет статусы доставки и
fail-safe эмитит `interaction/received`.

- **`supabase/migrations/20260720140000_webhook_inbound_pipeline.sql`** —
  две точечные правки существующей схемы (обе обязательны для пайплайна
  этого тикета, не создают новых таблиц — правило 3 не задействовано):
  1. `webhook_events.workspace_id` стал `nullable`. Причина: пайплайн §6.1
     пишет идемпотентную запись в `webhook_events` **до** резолва
     `channel_connection` (шаг 1 тикета — запись журнала; шаг 2 — резолв
     `channel_connection`, «нет или статус не активен → **пометить
     webhook_event ошибкой**» — то есть строка уже должна существовать).
     Для события с неизвестным внешним ID аккаунта workspace принципиально
     не определим на момент записи — раньше `NOT NULL` это исключал.
     Как только `channel_connection` находится, реальный `workspace_id`
     пишется в строку сразу при вставке (без отдельного `UPDATE`) — `null`
     остаётся только для действительно неизвестных аккаунтов.
  2. `messages.delivery_status` check-constraint расширен значением `read` —
     `message.read` реальный тип события Zernio (см. `parse.ts`
     `DM_EVENT_TYPES`, T-02), шаг 4 тикета явно требует обрабатывать
     `message.delivered/read/failed`, а исходная схема (E-001) допускала
     только `received/pending/sent/delivered/failed`.
  Обе миграции проверены на локальном Supabase (`supabase db reset`,
  `\d public.webhook_events`, `pg_get_constraintdef`).
- **`lib/inngest/client.ts`** — `export const inngest = new Inngest({ id:
  "drafta" })`; `import "server-only"` по аналогии с `lib/db/admin.ts` и
  `lib/channels/zernio/index.ts` (правило 5 по духу — секрет
  `INNGEST_EVENT_KEY` сама же SDK читает из `process.env`, если не передан
  явно, так что этот файл его вообще не трогает). Только клиент — `serve()`
  и функции-обработчики вне скоупа (открытый вопрос №2 эпика).
- **`lib/inngest/events.ts`** — `InteractionReceivedEvent` (`messageId`,
  `conversationId`, `workspaceId` — и только они, правило 7) и
  `emitInteractionReceived(payload)`: `try/await inngest.send(...) / catch`
  с `console.error`, никогда не бросает. Юнит-тесты —
  `lib/inngest/events.test.ts` (2): точный набор ключей payload'а (защита от
  случайного расширения объекта сверх типа) и fail-safe при `send()`,
  отклонённом промисом.
- **`lib/webhooks/process-event.ts`** — `processInboundEvent(supabase,
  event)`, ядро пайплайна на одно нормализованное событие: резолв
  `channel_connection` → идемпотентный `insert` в `webhook_events`
  (конфликт `23505` → тихий выход) → ветвление по типу события:
  - неизвестный/неактивный `channel_connection` → `webhook_events`
    помечается ошибкой, `processed_at = now()` (терминальный исход);
  - `message.received` + `kind = dm` → upsert `contact_identity` (+новый
    `contact` при первой личности), upsert `conversation` (`kind = dm`), insert
    `message` (конфликт `(conversation_id, external_id)` → тихий пропуск,
    без двойного инкремента счётчика), `unread_count += 1` +
    `last_incoming_at = now()` только для действительно нового сообщения,
    `webhook_events` помечается обработанным, fail-safe
    `emitInteractionReceived`;
  - `message.delivered/read/failed` → находит conversation/message по
    внешним ID и обновляет `delivery_status`;
  - любой другой нормализованный тип (например, `comment.received` — вне
    скоупа эпика) → `webhook_events` помечается обработанным с поясняющим
    `processing_error`, не ошибка.
  Гонки на `insert` (два вебхука создают одну и ту же новую личность/
  диалог одновременно) — конфликт `23505` перехватывается, победитель
  довыбирается `select`; проигравшая orphan-строка `contact` безвредна
  (ни на что не ссылается). Различает терминальные исходы (`markProcessed`,
  `processed_at` проставляется) от потенциально временных сбоев
  (`markUnprocessedWithError`, `processed_at` остаётся `null` — задел под
  будущий `reconcile-webhooks`, `webhook_events_processing_idx` уже есть в
  схеме). Никогда не бросает наружу — каждая ветка ловит свои ошибки.
- **`app/api/webhooks/[provider]/route.ts`** — тонкий HTTP-адаптер:
  `import "@/lib/channels/zernio"` (side-effect регистрация в реестре, как
  и предполагал отчёт T-02) → `resolveChannelAdapter(provider)` (неизвестный
  провайдер → 404) → `verifyWebhook` (невалидная подпись → 401, в БД ничего
  не пишется) → `parseWebhook` (невалидный JSON → 400) → цикл
  `processInboundEvent` по каждому нормализованному событию → `200`. Ни
  вызовов LLM, ни `lib/ai`, ни внешних отправок (правила 6, 8, 9).
- **`app/api/webhooks/[provider]/route.test.ts`** — 9 интеграционных
  тестов, роут вызывается напрямую (`import { POST } from "./route"`) с
  фикстурами T-02 (`lib/channels/zernio/__fixtures__/`), БД — локальный
  Supabase:
  1. happy path — contact/contact_identity/conversation/message созданы,
     `last_incoming_at`/`unread_count` обновлены, `webhook_events`
     обработан, `emitInteractionReceived` вызван с правильными ID;
  2. идемпотентность — тот же payload дважды → одна строка
     `webhook_events`, одно сообщение, `unread_count` не задвоен, Inngest
     вызван один раз;
  3. два сообщения одного отправителя (`whatsapp-dm.json` +
     `whatsapp-dm-with-attachment.json`, общий `account`/`conversation`/
     `sender`) → один contact, один contact_identity, одна conversation,
     два message, `unread_count = 2`;
  4. невалидная подпись → 401, ни `webhook_events`, ни `message` не
     созданы, Inngest не вызван;
  5. неизвестный внешний ID аккаунта → 200, `webhook_events` с
     `processing_error`, `workspace_id = null`, `message` нет;
  6. (доп.) неизвестный провайдер → 404;
  7. (доп.) неактивный `channel_connection` (`status = 'disconnected'`) →
     200, `webhook_events` с ошибкой, `workspace_id` при этом известен
     (в отличие от сценария 5), `message` нет;
  8. (доп.) `message.delivered` после предшествующего `message.received`
     обновляет `delivery_status` существующего сообщения на `delivered`;
  9. (доп.) fail-safe: `emitInteractionReceived` подменён на реджектящийся
     мок → ответ всё равно 200, сообщение всё равно сохранено (вторая
     линия защиты — собственный `try/catch` `process-event.ts` вокруг всего
     DM-пайплайна, независимо от того, что сам `emitInteractionReceived` и
     так не бросает по контракту).
  Сценарии 6–9 — сверх обязательного списка шага 5 тикета, добавлены для
  покрытия остальной логики шага 2/4, которую тикет реализовать требует, но
  явно не тестирует.
- **`.env.example`** — добавлены `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
  с комментариями (по аналогии с `ZERNIO_*` из T-02).
- **`docs/epics/epic_02/T-07-executive-summary.md`** — дописан шаг в п. 3
  «Env-переменные в Vercel и локально»: без `INNGEST_EVENT_KEY`/
  `INNGEST_SIGNING_KEY` эмиссия `interaction/received` в проде будет
  постоянно fail-safe отваливаться (не блокирует эпик — обработчиков
  события ещё нет, — но нужно на старте этапа 2).
- **`package.json`/`package-lock.json`** — добавлена зависимость `inngest`
  (`^4.13.0`). Установка потребовала `--legacy-peer-deps` (у `inngest`
  оптовый `peerDependenciesMeta`-опциональный пир на `@sveltejs/kit`,
  который конфликтует по версии `vite` с `vitest` в этом дереве —
  Next.js-приложение этот peer не использует). После установки прогнан
  обычный `npm install` (без флага) и затем `rm -rf node_modules && npm
  ci` — лок-файл стабилен и проходит строгую `npm ci`-проверку.

### Как проверено

Локальный Supabase поднят через `supabase start --exclude edge-runtime`
(в песочнице `edge-runtime`/`imgproxy`/`pooler`-контейнеры не стартуют —
`runc`/rlimit и TLS к registry.npmjs.org из Deno-воркера блокированы
прокси песочницы; ни один из этих сервисов пайплайну не нужен — Inngest,
не Supabase Edge Functions, исполняет тяжёлую логику). Postgres/PostgREST/
Auth/Realtime — подняты и использованы по-настоящему.

```
supabase db reset   # применяет 20260720140000_webhook_inbound_pipeline.sql
                     # поверх схемы E-001, без ошибок
npm run lint         # eslint . — 0 ошибок/предупреждений
npm run build        # next build — TypeScript-проверка прошла,
                      # 15/15 маршрутов, включая ƒ /api/webhooks/[provider]
npm test              # vitest run — 19 файлов, 104 теста, все прошли
                       #   (95 прежних из T-01/T-02 + 9 в route.test.ts
                       #   + 2 в lib/inngest/events.test.ts, минус контроль:
                       #   без NEXT_PUBLIC_SUPABASE_URL/…_PUBLISHABLE_KEY/
                       #   SUPABASE_SECRET_KEY route.test.ts корректно
                       #   skip'ается (7→9 тестов "skipped"), а не падает —
                       #   проверено отдельным прогоном с `unset`)
```

Дополнительно — ровно то, что по DoD тикета должен сделать ревьюер, сделано
и разработчиком заранее (не заменяет независимую проверку ревьюера, но
подтверждает работоспособность до передачи): поднят `npm run dev`,
вручную создан workspace + `channel_connection` (`zernio`/`telegram`/
`acct_tg_98213`) прямым SQL, `lib/channels/zernio/__fixtures__/
telegram-dm.json` отправлен **дважды** через `curl` с валидной
HMAC-SHA256-подписью (`X-Zernio-Signature`, секрет из `ZERNIO_WEBHOOK_SECRET`)
на `POST http://localhost:3000/api/webhooks/zernio`. Оба ответа — `200
{"ok":true}`. Проверка БД после обоих запросов: одна строка
`webhook_events` (`processed_at` заполнен, `processing_error` пуст), один
`contact` («Anna Keller»), один `contact_identity`, одна `conversation`
(`unread_count = 1`, `last_incoming_at` заполнен), один `message`. Тестовые
данные удалены (`delete from workspaces ...` — каскад подчистил всё
остальное), dev-сервер остановлен.

`npm run build`/`npx tsc --noEmit` — отдельно перепроверено, что `tsc
--noEmit` по всему `tsconfig.json` (в отличие от `next build`, который
типизирует только реальный граф приложения) даёт 2 ошибки в
`lib/channels/zernio/adapter.test.ts` — это **не мои файлы и не новая
проблема**: та же пара ошибок присутствовала уже в T-02 (`next build` их
не ловит, `npm test` не типочекает); не трогал.

`grep -rniE "zernio" lib app` вне `lib/channels/zernio/` — только
side-effect импорт в `route.ts`, строковые литералы `"zernio"` (значение
типа `ChannelProvider`, не сам провайдерский тип) в роуте/тестах и прозовые
комментарии — правило 4 не нарушено. `grep` на `lib/ai`/`fetch(`/`axios`/
`sendMessage` в `app/api/webhooks/` и `lib/webhooks/` — пусто (правила 6,
8, 9). `SUPABASE_SECRET_KEY` читается только в `lib/db/admin.ts` (плюс
проверка *наличия* переменной, не значения, в `route.test.ts` для
skip-гейта) — правило 5.

### Отклонения от плана тикета

1. **`webhook_events.workspace_id` сделан nullable + расширен
   `messages.delivery_status` на `read`** (миграция выше) — в шагах тикета
   явно не значится отдельным пунктом, но без этого шаг 2 тикета
   («нет или статус не активен → **пометить webhook_event ошибкой**») и
   шаг 4 («статусы доставки … `message.delivered/read/failed`») физически
   невыполнимы при исходной схеме E-001. Оба изменения — точечные правки
   существующих столбцов той же таблицы, которую и реализует этот тикет,
   не новые таблицы (правило 3 не задействовано) и не правки через
   дашборд (правило 2 соблюдено — только миграция).
2. **`lib/webhooks/process-event.ts` как отдельный модуль**, а не вся
   логика внутри `route.ts` — тикет явно не предписывает структуру файлов
   за пределами самого `route.ts`; вынос ядра пайплайна в `lib/webhooks/`
   сделан для читаемости (шаг 2 тикета — по сути 4 разных под-пайплайна) и
   не нарушает «провайдер-специфичный код — только в `lib/channels/`»
   (правило 4) — этот модуль провайдер-агностичен, работает с
   `NormalizedEvent`.
3. **Тесты `vi.mock("server-only", () => ({}))`** — тот же приём, что и
   `zernio/index.test.ts` из T-02 избегал (там — через проверку текста
   файла), но здесь тикет прямо требует «роут вызывается напрямую», а роут
   транзитивно тянет `lib/channels/zernio/index.ts` и `lib/db/admin.ts` —
   оба `import "server-only"`, что делает прямой динамический импорт
   невозможным без нейтрализации маркер-пакета (проверено эмпирически —
   `node -e` и голый vitest-тест до и после `vi.mock`). Нейтрализация
   затрагивает только тестовую среду (сам пакет `server-only` — намеренно
   no-op вне сборки Next.js в любом случае) и не меняет поведение
   production-кода.
4. **6 дополнительных тестов сверх обязательных 5** (см. «Что сделано»,
   `route.test.ts`) — не отклонение от объёма работы, а расширение
   покрытия логики, которую шаг 2/4 тикета явно требует реализовать
   (неактивный канал, статус доставки, неизвестный провайдер, fail-safe на
   уровне роута), но которую обязательный список шага 5 не называет по
   имени.
5. **Скип-гейт DB-тестов по переменным окружения, а не по отдельному
   npm-скрипту** — DoD тикета явно требует `npm test` (без указания
   отдельной команды) «включая интеграционные тесты роута»; в проекте уже
   есть прецедент вынесения БД-тестов в отдельный гейт (`tests/rls/` +
   `RLS_TEST_TARGET` + отдельный `npm run test:rls`), но там это отдельный
   npm-скрипт. Раз DoD этого тикета явно требует именно `npm test`,
   `route.test.ts` вместо этого использует `describe.skipIf` по наличию
   `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/
   `SUPABASE_SECRET_KEY` (те же переменные, что уже читает
   `lib/db/admin.ts`/`lib/db/env.ts` — новых имён не вводилось): без них
   `npm test` в свежем клоне остаётся зелёным (skip, не fail), а по
   рецепту DoD (`supabase start` → эти три переменные → `supabase db
   reset` → `npm test`) сценарии реально выполняются против настоящего
   Postgres — проверено оба состояния (см. «Как проверено»).

### Вне скоупа

- `serve()`-роут `app/api/inngest/route.ts` и Inngest-функции
  (`generate-draft` и другие) — этап 2 согласно тикету/эпику; здесь только
  клиент и fail-safe эмиссия `interaction/received`, как и предписывает
  «Открытый вопрос №2» эпика.
- Обработка `comment.received` — этап 5; нормализованный тип объявлен
  (T-01), но в этом роуте — «неизвестный тип, помечается и пропускается»,
  как и для любого провайдер-агностично необработанного типа.
- Настройки → Каналы (создание `channel_connection` через UI) — T-04;
  здесь `channel_connection` только читается, интеграционные тесты сеют
  тестовые строки напрямую через admin-клиент.
- Инбокс «Сообщения» (UI, чтение диалогов) — T-05/T-06.
- Загрузка/превью вложений — вложения только как метаданные в `messages`
  (уже так у T-01/T-02); без изменений в этом тикете.
- `reconcile-webhooks` cron (переобработка зависших `webhook_events`) —
  упомянут в архитектуре как отдельная будущая Inngest-функция; в этом
  тикете только заложена возможность через `processed_at IS NULL` для
  временных сбоев (см. «Отклонения», п. 1 и код `process-event.ts`).

### Открытые вопросы

Ручной шаг дописан в `docs/epics/epic_02/T-07-executive-summary.md`
(п. 3 доп.): нужны `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` в Vercel и
`.env.local`, иначе эмиссия `interaction/received` в проде будет постоянно
уходить в fail-safe-ветку (не блокирует эту эпику, но нужно к началу
этапа 2). Открытый вопрос №2 эпика («эмиссия Inngest-события на этапе 1»)
этим тикетом закрыт так, как предполагал сам эпик: клиент и fail-safe
эмиссия есть, `serve()`/функции-обработчики — нет.

### Доработка 1 (устранение замечания ревью)

Устранено единственное блокирующее замечание — race condition (lost update)
на `conversations.unread_count`.

- **`supabase/migrations/20260720150000_bump_conversation_unread_count_rpc.sql`**
  (новая миграция) — `security invoker`-функция
  `public.bump_conversation_unread_count(target_conversation_id uuid)`,
  ровно по образцу, предложенному ревьюером (`public.create_workspace`,
  `20260720130000_create_workspace_rpc.sql`): один SQL-стейтмент `update
  public.conversations set unread_count = unread_count + 1, last_incoming_at
  = now() where id = target_conversation_id`. Атомарность обеспечивает сам
  Postgres (сериализация конкурентных `UPDATE` одной строки на уровне
  storage), а не клиентский код. `security definer` не нужен (в отличие от
  `create_workspace`) — единственный вызывающий, `lib/webhooks/process-event.ts`,
  уже работает через сервисный клиент (`SUPABASE_SECRET_KEY`), у которого и
  так есть прямые права на таблицу и обход RLS (правило 5; тот же принцип,
  что и в `revoke all … from anon` / `grant … to service_role` в
  `20260720120000_add_workspace_rls_policies.sql`). `execute` отозван у
  `public` и выдан только `service_role` — `authenticated` эту функцию не
  вызывает (не клиентская операция).
- **`lib/webhooks/process-event.ts`**, `bumpConversationOnNewIncomingMessage` —
  вместо `select unread_count` → `update … value + 1` (два отдельных
  HTTP-вызова PostgREST, не атомарно) теперь один вызов
  `supabase.rpc("bump_conversation_unread_count", { target_conversation_id
  })`. Функция по-прежнему бросает исключение при ошибке — вызывающий код
  (`processIncomingDirectMessage`) ловит его тем же `try/catch`, что и
  раньше, поведение по остальным веткам (идемпотентность вставки сообщения,
  fail-safe эмиссия) не менялось.
- **`app/api/webhooks/[provider]/route.test.ts`** — добавлен 10-й
  интеграционный тест (регрессия на замечание ревью): 20 разных сообщений
  одного отправителя в один новый диалог отправляются в роут **параллельно**
  (`Promise.all`, не последовательно, как остальные тесты файла) — тот же
  сценарий, которым ревьюер эмпирически воспроизвёл баг вручную (`curl`).
  Проверяется `messages` = 20 (уникальность `(conversation_id, external_id)`
  и без того работала верно) и `conversations.unread_count` = 20 (до
  исправления падало из-за lost update, см. запись ревьюера — итог был 9 из
  20). Таймаут теста увеличен до 20 с (20 параллельных запросов к локальному
  Supabase иногда не укладываются в дефолтные 5 с).

Проверено заново по полному DoD после исправления (см. «Как проверено —
доработка 1» ниже) — все 105 тестов (было 104, +1 новый) проходят, включая
новый конкурентный тест (реально ловит race до фикса и подтверждает его
исчезновение после).

### Как проверено — доработка 1

```
npx supabase db reset   # 5/5 миграций применены без ошибок, включая новую
                         # 20260720150000_bump_conversation_unread_count_rpc.sql
                         # (тот же безобидный кэш pg-delta warning от прокси
                         # песочницы, что и раньше — к миграциям не относится)
npm run lint             # 0 ошибок/предупреждений
npm run build             # OK, 15/15 маршрутов
npm test  (с реальными env локального Supabase)
                          # 19 файлов / 105 тестов — все passed, включая новый
                          # конкурентный тест (471ms, unread_count = 20)
npm test  (без NEXT_PUBLIC_SUPABASE_URL/…)
                          # 18 файлов passed + 1 skipped / 95 passed + 10 skipped —
                          # route.test.ts по-прежнему корректно скипается целиком
```

Функция в БД проверена напрямую через `psql`: `security_type = INVOKER`,
`execute` выдан только `service_role` (плюс `postgres` как владелец), у
`public`/`authenticated`/`anon` прав нет.

`grep` на `lib/ai`/`fetch(`/`axios` в `app/api/webhooks/`, `lib/webhooks/` —
по-прежнему пусто; `SUPABASE_SECRET_KEY` — по-прежнему только в
`lib/db/admin.ts`. Терминология (`workspace`), правило 2 (только миграция),
правило 3 (новых таблиц не создано — только новая функция) не нарушены.

## 🔍 Ревью

### Вердикт: CHANGES_REQUESTED

### Что прогнано и с каким результатом

Независимо от отчёта разработчика, всё перепроверено заново на живом локальном
Supabase (Docker: `db`, `auth`, `rest`, `realtime`, `storage`; `edge-runtime`/
`imgproxy`/`pooler` пропущены — та же причина, что у разработчика: TLS к
registry.npmjs.org из Deno-воркера блокирован прокси песочницы, пайплайну эти
сервисы не нужны):

```
npx supabase start --exclude edge-runtime   # OK
npx supabase db reset                        # OK, 4/4 миграции применены без ошибок
                                              # (единственная ошибка в выводе —
                                              # кэш pg-delta каталога из-за прокси,
                                              # к самим миграциям не относится)
npm run lint     # OK, 0 ошибок/предупреждений
npm run build    # OK, 15/15 маршрутов, включая ƒ /api/webhooks/[provider]
npm test (без NEXT_PUBLIC_SUPABASE_URL/...)      # OK, 95 passed | 9 skipped (104) —
                                                   # route.test.ts корректно скипается
npm test (с реальными env локального Supabase)   # OK, 19 files / 104 tests — все passed,
                                                   # включая все 9 интеграционных тестов
                                                   # route.test.ts против настоящего Postgres
```

Схема проверена напрямую через `psql`: `webhook_events.workspace_id` —
`nullable`, FK `on delete cascade` сохранён; `messages_delivery_status_check`
расширен значением `read`. Оба соответствуют тому, что описано в отчёте.

Дополнительно (по DoD: «ревьюер... отправляет фикстуру в роут дважды,
проверяя идемпотентность по БД») — независимый ручной прогон: поднят
`npm run dev`, вручную заведены `workspace`/`channel_connection`
(`zernio`/`telegram`), `lib/channels/zernio/__fixtures__/telegram-dm.json`
отправлен `curl`'ом с валидной HMAC-подписью **дважды**. Оба ответа — `200
{"ok":true}`. Проверка БД: ровно одна строка `webhook_events` (`processed_at`
заполнен), один `contact` («Anna Keller»), один `contact_identity`, одна
`conversation` (`unread_count = 1`, не задвоен), одно `message`. Отдельно
проверены невалидная подпись (401, ничего не записано) и неизвестный провайдер
(404). Тестовые данные удалены после проверки.

### Замечания

1. **Race condition на `conversations.unread_count`** —
   `lib/webhooks/process-event.ts`, функция `bumpConversationOnNewIncomingMessage`
   (строки 396–415). Инкремент сделан как отдельные `select unread_count` →
   `update … unread_count: conversation.unread_count + 1` через два разных
   HTTP-вызова PostgREST, не атомарно и не в одной транзакции/`SELECT … FOR
   UPDATE`. При параллельных вебхуках для одного и того же диалога (что
   реалистично: несколько сообщений от клиента подряд, доставленные Zernio
   близко по времени) это классический lost update — часть инкрементов
   теряется.

   Эмпирически воспроизведено независимо от юнит/интеграционных тестов
   тикета (которые шлют события строго последовательно и race не ловят):
   20 новых различных сообщений в один новый диалог отправлены **параллельно**
   (одновременные `curl`, 19 из 20 — конкурентно). Итог в БД: все 20 `message`
   вставлены корректно (вставка защищена уникальным ограничением
   `(conversation_id, external_id)` и retry-select при конфликте — тут всё
   верно), но `conversations.unread_count` оказался равен **9**, а не 20.
   Счётчик непрочитанного — пользовательская фича (бейдж непрочитанных в
   инбоксе), явно требуемая шагом 2 тикета («инкрементировать счётчик
   непрочитанного») и покрытая тестами happy-path/идемпотентности в
   `route.test.ts`, но сами тесты не проверяют конкурентный сценарий, поэтому
   баг прошёл мимо CI.

   Что сделать: сделать инкремент атомарным на стороне Postgres — например,
   `security definer`-функция по образцу уже существующей
   `public.create_workspace` (`supabase/migrations/20260720130000_create_workspace_rpc.sql`)
   с `update conversations set unread_count = unread_count + 1, last_incoming_at = now() where id = …`
   одним SQL-выражением, вызываемая через `.rpc(...)`, либо эквивалентный
   атомарный `UPDATE ... SET unread_count = unread_count + 1`.

### Некритичные наблюдения (не блокируют)

- `processInboundEvent` резолвит `channel_connection` по паре
  `(provider, external_id)` без привязки к workspace (`lib/webhooks/process-event.ts:32-38`),
  что дословно соответствует шагу 2 тикета. Но в схеме уникальность
  `channel_connections` — только `(workspace_id, provider, external_id)`, не
  глобальная. Если два workspace когда-либо получат одинаковый
  `(provider, external_id)` (ручная ошибка при подключении канала в T-04),
  `.maybeSingle()` бросит ошибку «multiple rows», событие тихо потеряется без
  журналирования (ветка `channelConnectionError`). Вне скоупа T-03 (channel
  connections создаются в T-04), но стоит держать в уме при проектировании
  T-04 — например, рассмотреть глобальную уникальность `(provider, external_id)`.
- `emitInteractionReceived` в `processIncomingDirectMessage` вызывается через
  `await` внутри пути ответа вебхука; сам Inngest SDK делает до 5 попыток с
  backoff и не выставляет явный таймаут на `fetch`. Fail-safe по ошибкам
  подтверждён тестом и вручную (правило 7/критерий приёмки выполнены), но при
  недоступности Inngest (не просто ошибке, а зависании сети) это теоретически
  может отодвинуть ответ вебхука далеко за требуемые «доли секунды» (правило
  6). Порядок операций соответствует диаграмме §6.1 (эмиссия — синхронный шаг
  перед ответом 200), так что это не отклонение от документированного
  пайплайна, а риск, не проверяемый в текущей песочнице (нет живого Inngest
  эндпоинта). Стоит держать в уме на этапе 2 при реальном включении Inngest.

### Остальное — без замечаний

Критерии приёмки, кроме зафиксированного выше поведения `unread_count`,
подтверждены фактически (не по отчёту): пайплайн повторяет §6.1 (нет вызовов
LLM/внешних отправок в роуте — `grep` на `lib/ai`/`fetch(`/`axios` в
`app/api/webhooks/`, `lib/webhooks/` пуст), идемпотентность по
`webhook_events` и по `messages` работает, payload Inngest-события — строго
`messageId`/`conversationId`/`workspaceId` (типизировано и покрыто тестом с
проверкой точного набора ключей), fail-safe при ошибке эмиссии подтверждён,
невалидная подпись → 401 без записи в БД, `SUPABASE_SECRET_KEY` — только в
`lib/db/admin.ts`, сырой payload сохраняется в `webhook_events` целиком, все
тесты шага 5 присутствуют и проходят (плюс обоснованные дополнительные).
Терминология (`workspace`, не `account`), правило 4 (провайдерский код только
в `lib/channels/`) и правило 2 (схема — только миграцией) соблюдены.

Отклонение от плана (nullable `webhook_events.workspace_id` + расширение
`messages.delivery_status` значением `read`) обоснованно и прозрачно описано
в отчёте — реальный конфликт между шагами тикета и исходной схемой E-001, не
самовольное расширение скоупа.

**Резюме:** реализация в целом качественная и хорошо протестирована, но
пункт 1 — реальный, эмпирически подтверждённый баг в счётчике непрочитанных
сообщений (пользовательская фича, явно требуемая тикетом), поэтому вердикт —
CHANGES_REQUESTED. Правку делает разработчик; ревьюер код не исправляет.
