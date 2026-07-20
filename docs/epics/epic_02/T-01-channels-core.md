---
id: T-01
epic: E-002
title: "Ядро слоя каналов: типы, интерфейс адаптера, реестр"
type: dev
status: done
depends_on: []
created: 2026-07-19
updated: 2026-07-20
---

# T-01. Ядро слоя каналов: типы, интерфейс адаптера, реестр

## Цель

В `lib/channels/` существует провайдер-независимое ядро слоя абстракции каналов:
нормализованные типы событий, интерфейс адаптера, реестр провайдеров и дефолтные
capabilities платформ. Ядро типобезопасно, компилируется и покрыто тестами;
провайдер-специфичного кода в нём нет.

## Контекст

Обязательно прочитать перед выполнением:

- [5. Слой абстракции каналов](../../architecture/05-channels.md) — **вся глава**:
  интерфейс адаптера (4 операции), состав нормализованного события, capabilities
- [6. Модель данных, channel_connections](../../architecture/06-data-model.md#channel_connections) — провайдер, платформа, внешний ID, capabilities (jsonb)
- [12. Структура репозитория](../../architecture/12-repo-structure.md) — `lib/channels/`: types, registry, `zernio/`, `postmark/`, `meta/` (будущее)
- [14. Правила вайбкодинга](../../architecture/14-vibecoding-rules.md) — правило 4 (дисциплина импортов)
- [2. Глоссарий](../../architecture/02-glossary.md) — `channel_connection`, никогда «account»

Существенные факты:

- E-001 создал каркас Next.js и полную схему БД v1; `lib/channels/` ещё не существует.
- Этот тикет — только типы и инфраструктура; первый реальный адаптер (Zernio) — T-02.
- «Отправить исходящее» — операция интерфейса, но её реализация — этап 3;
  интерфейс объявляет её сейчас, чтобы контракт был полным.

## Шаги реализации

1. `lib/channels/types.ts` — нормализованные типы по [§5](../../architecture/05-channels.md#нормализованное-событие):
   - тип события: `message.received` | `comment.received` | `message.delivered` |
     `message.read` | `message.failed`;
   - ID события у провайдера (для идемпотентности), провайдер, платформа;
   - внешний ID аккаунта соцсети (для резолва `channel_connection`);
   - вид взаимодействия: `dm` | `comment`;
   - ссылка на диалог/пост (внешний ID диалога; для комментариев — метаданные поста);
   - сообщение: текст, вложения (метаданные), отправитель (внешний ID + отображаемое имя);
   - «сырые» метаданные провайдера (произвольный jsonb-совместимый объект).
2. `lib/channels/types.ts` (или отдельный файл) — интерфейс адаптера, четыре операции
   [§5](../../architecture/05-channels.md#интерфейс-адаптера):
   - `verifyWebhook(...)` — проверка подписи сырого запроса;
   - `parseWebhook(...)` — сырой payload → массив нормализованных событий;
   - `sendMessage(...)` — объявлена; реализация в адаптерах до этапа 3 —
     заглушка с явной ошибкой `NotImplemented`;
   - опциональная `getConnectUrl(...)` — ссылка подключения аккаунта соцсети.
3. `lib/channels/capabilities.ts` — тип capabilities и дефолты по платформам
   (`telegram`, `whatsapp`, `instagram`, `facebook`) как данные
   [§5](../../architecture/05-channels.md#capabilities-канала): окно ответа
   (WhatsApp — 24 ч), поддержка вложений, статусы прочтения, лимит длины,
   стиль тредирования, поддержка комментариев. Используются при создании
   `channel_connection` (T-04).
4. `lib/channels/registry.ts` — реестр: имя провайдера (`zernio` | `postmark` | `meta`)
   → экземпляр адаптера; функция резолва с понятной ошибкой для незарегистрированного
   провайдера. Пока реестр пуст — Zernio регистрируется в T-02.
5. Юнит-тесты: резолв из реестра (включая неизвестный провайдер), дефолтные
   capabilities платформ соответствуют таблице §5.

## Критерии приёмки

- [ ] `lib/channels/` содержит types, capabilities, registry; структура соответствует §12
- [ ] Нормализованное событие несёт все поля из §5 (тип, ID события, внешний ID аккаунта, платформа, вид, ссылка на диалог/пост, сообщение, сырые метаданные)
- [ ] Интерфейс адаптера объявляет все 4 операции §5; `sendMessage` — заглушка до этапа 3
- [ ] Дефолтные capabilities хранятся как данные (не зашиты в условия в коде) и покрывают 4 платформы
- [ ] В `lib/channels/` (вне будущих подпапок провайдеров) нет ни одного упоминания SDK/типов конкретных провайдеров
- [ ] Термины соответствуют глоссарию (`channel_connection`, никакого `account`)

## Definition of Done

```
npm run lint
npm run build
npm test
```

Ревьюер сверяет типы с §5 (нормализованное событие, интерфейс, capabilities)
и проверяет отсутствие провайдер-специфики в ядре.

---

## 🔧 Отчёт разработчика

### Что сделано

Создано провайдер-независимое ядро слоя каналов в `lib/channels/` — до этого тикета
каталог был пуст (только `.gitkeep`):

- `lib/channels/types.ts` — нормализованные типы и интерфейс адаптера:
  - `ChannelProvider` (`zernio | postmark | meta`), `ChannelPlatform`
    (`telegram | whatsapp | instagram | facebook`), `NormalizedEventType`
    (5 значений из §5), `InteractionKind` (`dm | comment`);
  - `NormalizedEvent` со всеми полями §5: `type`, `providerEventId` (идемпотентность
    `webhook_events`), `provider`, `platform`, `externalAccountId` (внешний ID
    аккаунта соцсети — для резолва `channel_connection` по (provider, external_id),
    как явно уточняет тикет), `interactionKind`, `conversation`
    (`NormalizedConversationRef`: внешний ID диалога/поста + `postMetadata` для
    комментариев), `message` (`NormalizedMessage`: `externalId` — идемпотентность
    `messages`, `text`, `attachments: NormalizedAttachment[]`, `sender:
    NormalizedSender` — внешний ID + отображаемое имя), `rawMetadata` — сырые
    метаданные провайдера целиком;
  - интерфейс `ChannelAdapter` — 4 операции §5: `verifyWebhook`, `parseWebhook`,
    `sendMessage` (объявлена, реализация — этапы адаптеров/этап 3), опциональная
    `getConnectUrl`;
  - `ChannelOperationNotImplementedError` — переиспользуемая ошибка для
    заглушек `sendMessage` в будущих адаптерах (T-02+), чтобы не дублировать
    формулировку в каждом адаптере.
- `lib/channels/capabilities.ts` — тип `ChannelCapabilities` (окно ответа в часах,
  вложения, статусы прочтения, лимит длины, стиль тредирования, поддержка
  комментариев) и `DEFAULT_CHANNEL_CAPABILITIES` — объект-данные с дефолтами для
  4 платформ (не условия в коде) + хелпер `getDefaultChannelCapabilities(platform)`,
  возвращающий копию (для T-04, чтобы не мутировать общий объект).
- `lib/channels/registry.ts` — реестр `Map<ChannelProvider, ChannelAdapter>`:
  `registerChannelAdapter`, `resolveChannelAdapter(provider: string)` (принимает
  `string`, а не `ChannelProvider` — резолвится по сегменту URL в вебхук-роуте
  T-03, значение которого не гарантированно валидно), `UnknownChannelProviderError`
  с понятным сообщением. Реестр пуст — как и предполагает тикет (Zernio
  регистрируется в T-02).
- Юнит-тесты: `lib/channels/capabilities.test.ts` (9 тестов — состав платформ,
  полнота capability-полей, WhatsApp 24ч, Telegram без окна, комментарии только
  у Instagram/Facebook, независимость копии) и `lib/channels/registry.test.ts`
  (4 теста — резолв зарегистрированного адаптера, понятная ошибка для известного,
  но незарегистрированного провайдера, понятная ошибка для полностью неизвестного
  имени, изоляция между провайдерами; между тестами `vi.resetModules()` +
  динамический `import`, так как реестр — модульный синглтон).

### Как проверено

Каталог `node_modules` в рабочей копии отсутствовал — перед проверками выполнен
`npm ci` (455 пакетов).

```
npm run lint    # eslint . — 0 ошибок/предупреждений
npm run build   # next build — компиляция + проверка типов TypeScript прошли,
                # 14 маршрутов собраны без ошибок
npm test        # vitest run — 13 файлов, 70 тестов, все прошли
                #   (в т.ч. новые lib/channels/capabilities.test.ts — 9,
                #   lib/channels/registry.test.ts — 4)
```

Дополнительно вручную проверено:
- `grep` по `lib/channels/*.ts` на упоминания провайдерских SDK/типов — совпадений
  нет (только строковые литералы `"zernio"` как значения `ChannelProvider`,
  которые ожидаются самой архитектурой §6, и текст в комментариях/тестах).
- `grep -i account` по `lib/channels/*.ts` (кроме тестов) — все вхождения относятся
  к «аккаунту соцсети» (`externalAccountId`, `account-connect flow`), а не к
  переименованию `channel_connection`; термин `channel_connection` нигде не
  подменён словом `account`, как того требует глоссарий §2.

### Отклонения от плана тикета

Нет отклонений от шагов и критериев приёмки. Дополнительно к минимуму из шага 5
(«резолв из реестра, включая неизвестный провайдер; дефолтные capabilities
платформ») добавлены: тест на изоляцию провайдеров в реестре и тест на
независимость копии, возвращаемой `getDefaultChannelCapabilities` — это
не расширяет скоуп ядра, только тестовое покрытие уже объявленного контракта.

### Вне скоупа

- Реализация адаптеров (Zernio и т.д.), сам `sendMessage`, comment-обработка —
  по плану тикета, следующие тикеты эпика (T-02+).
- `.env.example` (`ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`) — по T-02, не
  затронуто.

### Открытые вопросы / допущения

Capabilities платформ — данные, а не факт из архитектуры для каждой платформы:
§5 явно фиксирует только окно ответа WhatsApp (24 ч) и общий состав таблицы
capabilities. Остальные конкретные значения (окно ответа Instagram/Facebook,
лимиты длины сообщений, стиль тредирования, поддержка комментариев по
платформам) — разумные допущения на основе публичных ограничений платформ,
задокументированы комментарием в `lib/channels/capabilities.ts`. Так как это
данные (не код), их легко скорректировать в одном месте, когда появится
доступ к документации Zernio/Meta (открытый вопрос №1 эпика) — рекомендую
свериться на шаге T-07 (executive summary) вместе с фикстурами реальных
payload'ов.

## 🔍 Ревью

**Вердикт: APPROVED**

### Прогнанные команды (независимо от отчёта разработчика)

```
npm run lint    # eslint . — 0 ошибок/предупреждений (совпадает с отчётом)
npm run build   # next build — успешно, TypeScript-проверка прошла,
                #   15 маршрутов в дереве (14/14 статически сгенерированных —
                #   именно эту цифру отчёт называет «14 маршрутов»; расхождение
                #   не по коду тикета, некритично)
npm test        # vitest run — 13 файлов, 70 тестов, все прошли, включая
                #   lib/channels/capabilities.test.ts (9) и
                #   lib/channels/registry.test.ts (4) — совпадает с отчётом
```

Diff проверен напрямую (`git diff e30529a bfcc372 -- lib/channels/`) — в тикете
изменены/созданы ровно заявленные файлы, лишнего нет: `types.ts`,
`capabilities.ts` (+тест), `registry.ts` (+тест).

### Проверка критериев приёмки

- [x] `lib/channels/` содержит `types.ts`, `capabilities.ts`, `registry.ts` —
  соответствует §12 (`zernio/`, `postmark/`, `meta/` — будущие тикеты, вне скоупа T-01).
- [x] `NormalizedEvent` несёт все поля §5: `type`, `providerEventId`, `provider`,
  `platform`, `externalAccountId`, `interactionKind`, `conversation`, `message`,
  `rawMetadata`. Отклонение формулировки §5 («ID channel_connection») в пользу
  «внешнего ID аккаунта соцсети» — обоснованно и соответствует §6
  (`channel_connections`: «уникальность подключения — (workspace, провайдер,
  внешний ID)»): UUID `channel_connection` физически не известен на этапе
  парсинга сырого вебхука, резолвится позже по (provider, externalAccountId).
- [x] `ChannelAdapter` объявляет все 4 операции (`verifyWebhook`, `parseWebhook`,
  `sendMessage`, опциональный `getConnectUrl`); `sendMessage` — только
  объявлена (реализаций пока нет, адаптеров тоже нет — корректно для T-01),
  добавлен переиспользуемый `ChannelOperationNotImplementedError` под
  будущие заглушки в T-02+.
- [x] `DEFAULT_CHANNEL_CAPABILITIES` — данные, не условия в коде; покрывает
  4 платформы (telegram/whatsapp/instagram/facebook); WhatsApp 24ч — из §5.
- [x] `grep -rniE "zernio|postmark|meta" lib/channels/*.ts` (вне тестов) —
  только строковые литералы типа `ChannelProvider`/`ChannelAdapter` и
  комментарии, SDK/типов конкретных провайдеров нет.
- [x] Термины соответствуют глоссарию: `channel_connection` нигде не заменён
  на «account»; `externalAccountId`/«account-connect flow» относятся к
  внешнему аккаунту соцсети, а не к переименованию `channel_connection`
  (`grep -rniE "account" lib/channels/*.ts` — все вхождения такого рода).

### Некритичные замечания

1. `DEFAULT_CHANNEL_CAPABILITIES` типизирован как `Readonly<Record<ChannelPlatform,
   ChannelCapabilities>>` — это защищает только верхний уровень (нельзя
   переприсвоить `DEFAULT_CHANNEL_CAPABILITIES.telegram`), но не поля внутри
   (`DEFAULT_CHANNEL_CAPABILITIES.telegram.supportsAttachments = false`
   пройдёт тайпчек и рантайм без ошибки). Тест проверяет только независимость
   копии из `getDefaultChannelCapabilities`, а не защищённость самого
   константного объекта. Не блокирует — предполагаемый путь использования
   (через хелпер) безопасен, но стоит учесть в T-04, если понадобится
   действительно неизменяемый источник.
2. Значения capabilities, не зафиксированные явно в §5 (лимиты длины, стиль
   тредирования, поддержка комментариев по платформам, окна ответа
   Instagram/Facebook), — задокументированные допущения разработчика, по
   плану эпика подлежат сверке в T-07 вместе с реальными payload'ами. Учтено
   разработчиком в разделе «Открытые вопросы», согласуется с открытым
   вопросом №1 эпика — фиксирую здесь на будущее, не считаю это дефектом T-01.

Замечаний, блокирующих принятие тикета, нет.
