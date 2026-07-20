---
id: T-02
epic: E-002
title: "Адаптер Zernio (DM): подпись, парсинг, фикстуры"
type: dev
status: rework
depends_on: [T-01]
created: 2026-07-19
updated: 2026-07-20
---

# T-02. Адаптер Zernio (DM): подпись, парсинг, фикстуры

## Цель

Адаптер Zernio в `lib/channels/zernio/` проверяет подпись вебхука и превращает сырые
DM-payload'ы в нормализованные события; юнит-тесты «фикстура → ожидаемое событие»
проходят и служат контрактом абстракции.

## Контекст

Обязательно прочитать перед выполнением:

- [5. Слой абстракции каналов](../../architecture/05-channels.md) — интерфейс адаптера, нормализованное событие, дисциплина импортов
- [7. Потоки данных, §6.1](../../architecture/07-data-flows.md#61-входящее-dm-или-комментарий) — где адаптер вызывается в пайплайне
- [13. Окружения, секреты](../../architecture/13-environments-secrets.md#секреты-vercel-env) — `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`
- [14. Правила вайбкодинга](../../architecture/14-vibecoding-rules.md) — правило 4; «юнит-тесты на адаптеры» из раздела «Тесты»
- [17. Риски](../../architecture/17-risks.md) — зависимость от Zernio, «самый рискованный этап»

Существенные факты:

- T-01 создал типы, интерфейс адаптера и реестр — реализовать интерфейс, не менять его.
- **Открытый вопрос №1 эпика:** точный формат payload и механизм подписи Zernio не
  зафиксированы в архитектуре. Рабочее допущение — HMAC-подпись заголовком по
  `ZERNIO_WEBHOOK_SECRET`; структуру payload взять из доступной документации Zernio,
  а при её отсутствии — спроектировать фикстуры по составу нормализованного события §5
  и вынести маппинг в один легко правимый модуль. После первых живых вебхуков
  фикстуры сверяются с реальными payload'ами из `webhook_events` (шаг T-07).
- Скоуп — только DM (`message.received` + статусы доставки, если Zernio их шлёт).
  Comment-вебхуки — этап 5. Отправка исходящих — этап 3 (заглушка из T-01).
- Zernio покрывает платформы: Telegram, WhatsApp, Facebook, Instagram (DM).

## Шаги реализации

1. `lib/channels/zernio/` — структура: `adapter.ts` (реализация интерфейса),
   `parse.ts` (маппинг payload → нормализованные события), `verify.ts` (подпись),
   фикстуры в `__fixtures__/` (или рядом с тестами).
2. `verifyWebhook`: HMAC-проверка по `ZERNIO_WEBHOOK_SECRET` (секрет читается только
   в серверном коде); константное сравнение; невалидная/отсутствующая подпись →
   отказ. Точный заголовок/алгоритм — по докам Zernio; вынести в одно место.
3. `parseWebhook`: сырой JSON → массив нормализованных событий `message.received`
   для DM: ID события у провайдера, внешний ID аккаунта, платформа, `kind = dm`,
   внешний ID диалога, текст, метаданные вложений, отправитель (внешний ID +
   отображаемое имя), сырые метаданные провайдера целиком. Неизвестные типы
   событий не роняют парсер — пропускаются с пометкой.
4. Зарегистрировать адаптер в реестре под именем `zernio`.
5. Фикстуры: минимум входящее Telegram-DM и WhatsApp-DM (+ вариант с вложением,
   + невалидная подпись). Юнит-тесты: каждая фикстура → ожидаемое нормализованное
   событие (поле в поле); неверная подпись отклоняется; неизвестный тип события
   не ломает парсинг остальных.
6. Обновить `.env.example` (или аналог из E-001): `ZERNIO_API_KEY`,
   `ZERNIO_WEBHOOK_SECRET` с комментариями.

## Критерии приёмки

- [ ] Весь Zernio-специфичный код — только в `lib/channels/zernio/`; наружу экспортируются лишь нормализованные типы из T-01 (правило 4)
- [ ] `verifyWebhook` отклоняет запрос с неверной/отсутствующей подписью
- [ ] `parseWebhook` для DM-фикстур возвращает нормализованные события со всеми полями §5, включая сырые метаданные
- [ ] Юнит-тесты на фикстурах проходят: Telegram, WhatsApp, вложение, невалидная подпись, неизвестный тип события
- [ ] `sendMessage` — явная заглушка `NotImplemented` (этап 3)
- [ ] Допущения о формате Zernio задокументированы в коде (комментарий у маппинга) и в отчёте разработчика

## Definition of Done

```
npm run lint
npm run build
npm test        # включая тесты адаптера на фикстурах
```

Ревьюер сверяет маппинг фикстур с составом нормализованного события §5
и проверяет отсутствие импортов Zernio-типов вне `lib/channels/zernio/`.

---

## 🔧 Отчёт разработчика

### Что сделано

Создан адаптер Zernio в `lib/channels/zernio/` (каталога не существовало —
только пустой T-01/`lib/channels/.gitkeep` на уровень выше):

- `lib/channels/zernio/parse.ts` — `parseZernioWebhook(input): NormalizedEvent[]`,
  маппинг сырого Zernio-payload'а в нормализованные события §5. Внутренние
  (не экспортируемые вне файла) типы `ZernioWebhookEnvelope` /
  `ZernioRawAccount` / `ZernioRawMessage` / `ZernioRawAttachment` описывают
  допущение о конверте: `{ id, event, account: { id, platform }, message: {
  id, conversation: { id }, text?, attachments?, sender: { id, name? } },
  metadata?, timestamp? }`. Обрабатываются `message.received`,
  `message.delivered`, `message.read`, `message.failed` (DM-скоуп тикета);
  всё остальное (`comment.received`, `reaction.received`, `call.*`,
  `account.connected` и т.п. — реальные типы событий Zernio, но вне скоупа
  этого эпика) и неизвестные/неполные платформы (кроме
  `telegram|whatsapp|instagram|facebook`) — пропускаются с
  `console.warn`, не бросая исключение; парсинг остатка батча продолжается.
  На вход принимается один конверт **или** массив конвертов (докам не
  удалось подтвердить, батчит ли Zernio несколько событий в одном вызове —
  сделано защитно в обе стороны). `rawMetadata` нормализованного события —
  весь сырой конверт целиком (ничего не теряется, даже если допущение о
  вложенных полях неверно).
- `lib/channels/zernio/verify.ts` — `verifyZernioSignature(input, secret): boolean`.
  HMAC-SHA256 (lowercase hex) сырого тела, ключ — секрет; сравнение —
  `crypto.timingSafeEqual` с предварительной проверкой длины (без
  которой `timingSafeEqual` бросает исключение на несовпадающей длине).
  Заголовок `X-Zernio-Signature`, плюс legacy-алиас `X-Late-Signature`
  (оба подтверждены доками Zernio, см. «Допущения» ниже) — оба lower-case,
  как того требует контракт `VerifyWebhookInput.headers` из T-01.
- `lib/channels/zernio/adapter.ts` — `createZernioAdapter(getWebhookSecret:
  () => string): ChannelAdapter` — чистая фабрика (не читает `process.env`,
  не импортирует `server-only`), реализующая все 4 операции интерфейса
  T-01: `verifyWebhook`/`parseWebhook` делегируют в `verify.ts`/`parse.ts`,
  `sendMessage` — заглушка, кидающая `ChannelOperationNotImplementedError`
  (этап 3). Секрет внедряется геттером, а не читается напрямую — чтобы файл
  можно было юнит-тестировать без секретов окружения и без `server-only`.
- `lib/channels/zernio/index.ts` — `import "server-only"`; читает
  `process.env.ZERNIO_WEBHOOK_SECRET` (бросает при отсутствии, по образцу
  `lib/db/admin.ts#getSupabaseSecretKey`), строит `zernioAdapter =
  createZernioAdapter(getZernioWebhookSecret)` и сразу же
  `registerChannelAdapter(zernioAdapter)` — регистрация под именем
  `"zernio"` происходит при импорте модуля (по контракту `lib/channels/registry.ts`
  из T-01). Ничего в этом эпике пока не импортирует `index.ts` — это сделает
  вебхук-роут в T-03 (`app/api/webhooks/[provider]/`).
- Фикстуры — `lib/channels/zernio/__fixtures__/`: `telegram-dm.json`,
  `whatsapp-dm.json`, `whatsapp-dm-with-attachment.json` (вариант с
  вложением), `unknown-event-type.json` (`reaction.received` — реальный тип
  события Zernio вне DM-скоупа), `unsupported-platform.json`
  (`message.received` для `twitter` — Zernio поддерживает больше платформ,
  чем этот продукт), `batch-with-unknown-event.json` (массив: telegram +
  unknown + whatsapp — проверка, что один неизвестный тип не роняет
  остальные события батча).
- Тесты (vitest, 23 новых): `parse.test.ts` (9 — Telegram/WhatsApp
  «поле в поле» через `toEqual`, вложение, неизвестный тип, неподдерживаемая
  платформа, батч с пропуском, малформед-конверт, `message.delivered`,
  `rawMetadata` целиком), `verify.test.ts` (8 — валидная подпись, legacy
  заголовок, регистронезависимость, неверный секрет, подмена тела,
  отсутствующая подпись, подпись неверной длины, отсутствующий секрет),
  `adapter.test.ts` (4 — provider, делегирование `verifyWebhook`/`parseWebhook`,
  `sendMessage` кидает `ChannelOperationNotImplementedError`), `index.test.ts`
  (2 — текстовые проверки, что `index.ts` содержит `import "server-only";`,
  читает `ZERNIO_WEBHOOK_SECRET` и регистрирует адаптер, а `adapter.ts` не
  содержит `import "server-only";`). `index.ts` (как и `lib/db/admin.ts` в
  T-01/E-001) нельзя динамически импортировать в vitest — `server-only`
  бросает исключение вне сборки Next.js (проверено: `node -e
  "require('server-only')"` бросает немедленно); поэтому `index.test.ts`
  проверяет текст файла тем же приёмом, что уже применён в
  `lib/db/auth-boundaries.test.ts`, а не динамическим импортом.
- `.env.example` — добавлены `ZERNIO_API_KEY` и `ZERNIO_WEBHOOK_SECRET` с
  комментариями (назначение, ссылка на `verify.ts`, предупреждение не
  коммитить реальные значения).

### Допущения о формате Zernio (открытый вопрос №1 эпика)

Архитектура (§13, вопрос №1 эпика) не фиксирует точный payload/подпись —
рабочее допущение требовалось спроектировать самостоятельно. Перед
проектированием фикстур сделан веб-поиск публичной документации Zernio
(`docs.zernio.com`, `github.com/zernio-dev/*`, 2026-07-20) — Zernio
оказался реальным сервисом, и часть допущений удалось **подтвердить**,
а не просто предположить:

- **Подтверждено доками:** заголовок подписи `X-Zernio-Signature` (плюс
  legacy-алиас `X-Late-Signature`), алгоритм — lowercase hex HMAC-SHA256
  сырого тела запроса на секрете. Список типов событий включает
  `message.received/sent/edited/deleted/delivered/read/failed`,
  `reaction.received`, `comment.received` и другие — реализовано в
  `verify.ts`/`parse.ts` как факт, не предположение.
- **Частично подтверждено:** конверт webhook-вызова для инбокс-событий
  несёт поля `id` (stable webhook event id), `event`, `account`
  (`accountInboxWebhookAccount`), `message`
  (`conversationInboxWebhookConversation`), опциональный `metadata`
  (интерактивные тапы), `timestamp` — это в доках Zernio есть. Публичная
  документация **не** раскрывает точные вложенные поля `account`/`message`
  (что именно означает и как называется внешний ID диалога/сообщения,
  отправителя, вложений) и не подтверждает, батчит ли один HTTP-вызов
  несколько событий — эта часть (вложенные поля `ZernioRawAccount` /
  `ZernioRawMessage` / `ZernioRawAttachment` в `parse.ts`, поддержка
  батча-массива) — **допущение**, спроектированное по составу
  нормализованного события §5, как и предписывает тикет. Задокументировано
  комментарием прямо над типами в `parse.ts`.
- Платформы продукта ограничены `telegram|whatsapp|instagram|facebook` по
  скоупу эпика — хотя Zernio поддерживает больше (Twitter/X, Reddit,
  Bluesky и др.); события для остальных платформ пропускаются, а не
  роняют парсер (фикстура `unsupported-platform.json`).
- `T-07` (executive summary) уже содержит шаг 6 «Сверить живые payload'ы
  с фикстурами» — покрывает донастройку после первых живых вебхуков; новых
  шагов туда не добавлено, так как всё нужное там уже есть.

### Как проверено

```
npm run lint    # eslint . — 0 ошибок/предупреждений
npm run build   # next build — компиляция + TypeScript-проверка прошли,
                # 14 маршрутов собраны без ошибок (совпадает с T-01)
npm test        # vitest run — 17 файлов, 93 теста, все прошли
                #   (70 прежних из T-01 + 23 новых в lib/channels/zernio/:
                #   parse.test.ts — 9, verify.test.ts — 8, adapter.test.ts — 4,
                #   index.test.ts — 2)
```

Дополнительно вручную проверено:
- `grep -rniE "zernio" lib app --include=*.ts --include=*.tsx` вне
  `lib/channels/zernio/` — только `lib/mock/*` (независимые UI-mock-данные
  из E-001/T-07, вне скоупа этого тикета, не переиспользуют типы
  `lib/channels/`) и prose-упоминания «Zernio» в комментариях T-01
  (`types.ts`, `capabilities.ts`) — Zernio-специфичных типов/SDK вне
  `lib/channels/zernio/` нет (правило 4).
- Экспорты `lib/channels/zernio/*.ts` — только `parseZernioWebhook`,
  `verifyZernioSignature`, `createZernioAdapter`, `zernioAdapter`; сырые
  Zernio-типы (`ZernioWebhookEnvelope` и вложенные) наружу файла не
  экспортируются.
- `grep -rniE "account" lib/channels/zernio/*.ts` (вне тестов) — все
  вхождения про «аккаунт соцсети» на стороне Zernio (их собственное поле
  `account` в конверте, `externalAccountId`), термин `channel_connection`
  нигде не заменён на `account` — соответствует глоссарию §2, тот же
  паттерн, что одобрен ревью T-01.

### Отклонения от плана тикета

Файловая структура шире минимума, буквально перечисленного в тикете
(`adapter.ts`, `parse.ts`, `verify.ts`, фикстуры) — добавлен `index.ts`.
Причина: интерфейс `verifyWebhook`/`parseWebhook`/`sendMessage` из T-01 не
принимает секрет параметром — сам адаптер должен читать
`ZERNIO_WEBHOOK_SECRET`, а этот секрет по духу правила 5 (аналог
`SUPABASE_SECRET_KEY`) и по тексту шага 2 тикета («секрет читается только в
серверном коде») требует `import "server-only"` (по образцу
`lib/db/admin.ts`, единственного прецедента в кодовой базе). Но
`server-only` физически бросает исключение при любом импорте вне сборки
Next.js (проверено в песочнице) — значит, файл с этим импортом нельзя
динамически импортировать в vitest. Чтобы не терять юнит-тестируемость
`verifyWebhook`/`parseWebhook`/`sendMessage` как единого объекта-адаптера
(не только их внутренностей по отдельности), логика вынесена в чистую
фабрику `createZernioAdapter(getWebhookSecret)` (`adapter.ts`, без
`server-only`/`process.env`), а чтение секрета и регистрация в реестре —
в отдельный `index.ts` с `server-only`. Это расширяет заявленный список
файлов, но не расширяет скоуп: `adapter.ts` по-прежнему «реализация
интерфейса», как и просит тикет, просто в форме фабрики. Оба файла
внутри `lib/channels/zernio/` — правило 4 не нарушено.

Второе отклонение: юнит-тест регистрации в реестре (`index.test.ts`)
проверяет исходный текст `index.ts`, а не выполняет динамический импорт +
`resolveChannelAdapter("zernio")` — по той же причине (`server-only`
несовместим с обычным Node/vitest-импортом). Это тот же приём, что уже
применён в этой кодовой базе для `lib/db/admin.ts`
(`lib/db/auth-boundaries.test.ts`), а не новый паттерн.

### Вне скоупа

- Вебхук-роут `app/api/webhooks/[provider]/`, вызов `verifyWebhook`/
  `parseWebhook` из него, идемпотентность через `webhook_events` — T-03.
- Реализация `sendMessage` (реальная отправка через Zernio API,
  `ZERNIO_API_KEY`) — этап 3 согласно тикету/эпику; сейчас — только
  заглушка.
- Обработка `comment.received` — этап 5; в парсере это «неизвестный тип»,
  сознательно пропускается.
- Настройка вебхука/секрета в дашборде Zernio, реальный DPA, сверка живых
  payload'ов с фикстурами — уже покрыто шагами T-07 (executive summary),
  новых шагов не добавлялось.

### Открытые вопросы

Нет новых сверх открытого вопроса №1 эпика (см. «Допущения» выше) — он
остаётся открытым до живого доступа к Zernio (T-07, шаг 6), но теперь
частично сужен подтверждёнными фактами из публичной документации.

## 🔍 Ревью

**Вердикт: CHANGES_REQUESTED**

### Прогнанные команды (независимо от отчёта разработчика)

```
npm run lint    # eslint . — 0 ошибок/предупреждений (совпадает с отчётом)
npm run build   # next build — успешно, TypeScript-проверка прошла,
                #   14/14 маршрутов сгенерированы (совпадает с отчётом)
npm test        # vitest run — 17 файлов, 93 теста, все прошли
                #   (совпадает с отчётом: 70 из T-01 + 23 новых в lib/channels/zernio/)
```

Diff проверен напрямую (`git diff main --stat`) — только заявленные файлы в
`lib/channels/zernio/`, `.env.example`, файлы тикетов/STATUS.md.

### Проверка критериев приёмки

- [x] Zernio-специфичный код только в `lib/channels/zernio/`; наружу экспортируются
  только `parseZernioWebhook`, `verifyZernioSignature`, `createZernioAdapter`,
  `zernioAdapter` — сырые Zernio-типы не экспортируются
  (`grep -rniE "zernio" lib app --include=*.ts --include=*.tsx` вне
  `lib/channels/zernio/` — только независимый mock-слой E-001/T-07 и строковые
  литералы `ChannelProvider`, как и заявлено в отчёте).
- [x] `verifyZernioSignature` отклоняет неверную/отсутствующую подпись — 8 тестов
  на фикстурах в `verify.test.ts`, все проходят.
- [x] `sendMessage` — явная заглушка `ChannelOperationNotImplementedError`
  (`adapter.ts:47-49`, тест в `adapter.test.ts`).
- [ ] **`parseWebhook` НЕ возвращает корректные нормализованные события для
  реальных Zernio-payload'ов** — маппинг в `parse.ts` расходится с реальной,
  публично доступной документацией Zernio, хотя тикет требует в первую очередь
  "структуру payload взять из доступной документации Zernio" (раздел
  «Существенные факты»). Подробности и релевантность — ниже.

### Главное замечание (блокирует принятие)

Публичный OpenAPI-контракт Zernio (`https://docs.zernio.com/api/openapi`,
ссылка с `docs.zernio.com` — один переход от главной страницы доков) описывает
схему `WebhookPayloadMessage` (событие `message.received`) и
`WebhookPayloadMessageDeliveryStatus` (`message.delivered/read/failed`) так:

```yaml
WebhookPayloadMessage:
  required: [id, event, message, conversation, account, timestamp]
  properties:
    message: { $ref: InboxWebhookMessage }   # id, conversationId (строка!), platform,
                                              # platformMessageId, direction, text,
                                              # attachments, sender, sentAt, isRead —
                                              # никакого вложенного `conversation`-объекта
    conversation: { $ref: InboxWebhookConversation }  # ВЕРХНЕУРОВНЕВОЕ поле,
                                              # соседнее с `message`, а не вложенное в него
    account: { $ref: InboxWebhookAccount }
```

Т.е. `conversation` — это поле верхнего уровня конверта, соседнее с `message` и
`account`, а не вложенное в `message`. У `InboxWebhookMessage` есть только
плоская строка `conversationId`, никакого объекта `message.conversation` не
существует вовсе.

В реализации же (`lib/channels/zernio/parse.ts`):

- `ZernioRawMessage.conversation: { id: string }` (строка 60) — придуманное
  вложенное поле;
- `isZernioMessage()` (строки 119-139) требует `candidate.conversation` как
  объект с `id`;
- `parseSingleEnvelope()` читает `raw.message.conversation.id` (строка 190).

**Следствие**: на настоящем Zernio-payload'е (соответствующем их реальной,
публично доступной схеме) `raw.message.conversation` будет `undefined` —
`isZernioMessage()` вернёт `false`, и `parseZernioWebhook` молча (только
`console.warn`) отбросит **каждое** реальное DM-событие как «no usable message
payload». Первый же живой вебхук на шаге T-07 (сверка фикстур с реальностью)
исчезнет без ошибки — притом что весь смысл адаптера и критерий приёмки №3
тикета («`parseWebhook` для DM-фикстур возвращает нормализованные события») —
именно корректный маппинг реального payload'а.

Второе, менее критичное расхождение с той же схемой: элементы `attachments` в
`InboxWebhookMessage` несут только `type`, `url` и непрозрачный объект
`payload` — полей `file_name`/`mime_type` в реальной схеме нет. Маппинг
`mapAttachment()` (`parse.ts:141-148`, читает `raw.file_name`/`raw.mime_type`)
на реальном payload'е всегда даст `fileName: undefined, mimeType: undefined` —
тихая потеря части заявленных в критерии приёмки «метаданных вложений».

Дополнительно: отчёт разработчика утверждает — «Публичная документация **не**
раскрывает точные вложенные поля `account`/`message`… это часть —
допущение». Проверка показала, что это **не так**: OpenAPI-спецификация с
точным составом полей `InboxWebhookMessage`/`InboxWebhookConversation`/
`InboxWebhookAccount` публично доступна и легко находится с главной страницы
`docs.zernio.com`. Остальные подтверждённые в отчёте факты (заголовок подписи
`X-Zernio-Signature` + legacy-алиас `X-Late-Signature` — Zernio действительно
ранее назывался Late, алгоритм HMAC-SHA256 сырого тела, полный список типов
событий `message.received/sent/edited/deleted/delivered/read/failed`,
`reaction.received`, `comment.received` и др.) — при независимой проверке
совпали с реальной документацией; проблема именно в вывезенном "частично
подтверждено" по вложенным полям `account`/`message`, где документация на
самом деле была доступна и однозначна, но не использована (или использована
неверно).

Это не вопрос вкусовщины и не то, что тикет разрешает списать на «допущение,
сверим в T-07»: пункт «Существенные факты» тикета явно ставит «взять из
доступной документации» **выше** «спроектировать самостоятельно», а
допущение уместно только «при её отсутствии». Документация была доступна.

**Что нужно сделать:**

1. В `parse.ts` читать `externalId` диалога из верхнеуровневого поля
   `conversation` конверта (`conversation.id` или `conversation.platformConversationId`),
   а не из `message.conversation.id`; обновить `ZernioWebhookEnvelope`/
   `ZernioRawMessage`/валидаторы `isZernioEnvelope`/`isZernioMessage`
   соответственно реальной схеме (`account`, `message`, `conversation` —
   три соседних поля верхнего уровня).
2. Поправить `mapAttachment()` под реальные поля вложений (`type`, `url`,
   `payload`) — решить, что делать с `fileName`/`mimeType` (по всей видимости,
   реальная схема их не даёт напрямую; либо не заполнять, либо доставать
   из `payload`, если там что-то есть, задокументировав это явно).
3. Перегенерировать фикстуры (`telegram-dm.json`, `whatsapp-dm.json`,
   `whatsapp-dm-with-attachment.json`, `batch-with-unknown-event.json`,
   `unknown-event-type.json`, `unsupported-platform.json`) и тесты
   (`parse.test.ts`) под исправленную форму конверта.
4. Поправить формулировку в отчёте/комментариях кода — реальная документация
   по вложенным полям `account`/`message` была доступна, это не
   неподтверждаемое допущение.

### Некритичные замечания (не блокируют, но стоит учесть при исправлении)

1. Комментарий в `parse.ts:17-18` называет типы Zernio
   `accountInboxWebhookAccount`/`conversationInboxWebhookConversation` — в
   реальной OpenAPI-спецификации они называются `InboxWebhookAccount` и
   `InboxWebhookConversation` (без префикса по имени поля). Стоит поправить
   заодно с остальными правками по этой же документации.
2. `NormalizedMessage.externalId` берётся из `message.id` (внутренний Zernio
   ID) — в реальной схеме есть также `platformMessageId` (ID сообщения на
   стороне платформы). Для идемпотентности `webhook_events`/`messages`
   внутренний Zernio ID тоже подходит (провайдер в терминах §5 — именно
   Zernio, не сама платформа), поэтому не блокирует, но стоит явно
   зафиксировать этот выбор в комментарии при исправлении маппинга.
3. Остальное (структура файлов `adapter.ts`/`index.ts` из-за `server-only`,
   приём тестирования `index.ts` через чтение исходника, дисциплина
   импортов, `.env.example`) — проверено, замечаний нет.

### Итог

Инфраструктурная часть тикета (подпись, реестр, разделение
`adapter.ts`/`index.ts` под `server-only`, тесты, `.env.example`) выполнена
аккуратно и корректно. Но центральная часть тикета — маппинг реального
Zernio DM-payload'а в нормализованное событие — не соответствует реальной,
доступной документации Zernio в структурно значимой части (`conversation` —
поле верхнего уровня, а не вложенное в `message`), из-за чего парсер на
практике отбросит все настоящие DM-вебхуки. Это затрагивает критерий приёмки
№3 и №6 (допущения должны быть корректно задокументированы) и является
блокирующим.
