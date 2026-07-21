---
id: T-01
epic: E-003
title: "Inngest-контур: serve-роут, типизация событий, локальный dev"
type: dev
status: rework
depends_on: []
created: 2026-07-19
updated: 2026-07-21
---

# T-01. Inngest-контур: serve-роут, типизация событий, локальный dev

## Цель

Событие `interaction/received`, которое вебхук эмитит с E-002, доставляется до
зарегистрированной Inngest-функции: работает `app/api/inngest/route.ts` (serve),
схемы событий типизированы (payload — строго только ID), локальный контур с
Inngest Dev Server описан и проверен — фикстура в вебхук приводит к выполнению
функции-скелета.

## Контекст

Обязательно прочитать перед выполнением:

- [7. Потоки данных, §6.2](../../architecture/07-data-flows.md#62-дебаунс-и-генерация-черновика) — GDPR-правило «payload только ID» (жёсткое, правило 7)
- [12. Структура репозитория](../../architecture/12-repo-structure.md) — `app/api/inngest/` (serve всех функций), `lib/inngest/functions/`
- [13. Окружения, секреты](../../architecture/13-environments-secrets.md) — `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (прод; локально не нужны), локальная разработка: `npx inngest-cli dev`
- [14. Правила вайбкодинга](../../architecture/14-vibecoding-rules.md) — правило 7

Существенные факты:

- E-002/T-03 уже создал `lib/inngest/client.ts` и fail-safe эмиссию
  `inngest.send("interaction/received", …)` из вебхук-роута с payload
  `{ messageId, conversationId, workspaceId }`. Обработчиков и serve-роута нет —
  это и есть данный тикет. Fail-safe эмиссию сохранить: падение Inngest не должно
  ломать вебхук.
- Событие `draft/regenerate.requested` (регенерация черновика по кнопке «заново»)
  объявляется здесь же в схемах, обработчик появится в T-05, эмиссия из UI — в T-07.
- Реальная функция `generate-draft` — T-05; здесь достаточно скелета
  (лог только ID, без логики), который T-05 заменит, — он нужен, чтобы проверить
  сквозную доставку события.
- Актуальный API Inngest SDK (`EventSchemas`, `serve` для Next.js App Router) —
  сверяться с официальной документацией Inngest, не с памятью.

## Шаги реализации

1. `lib/inngest/events.ts`: типизированные схемы событий через `EventSchemas`:
   - `interaction/received`: `{ messageId: string; conversationId: string; workspaceId: string }`;
   - `draft/regenerate.requested`: `{ conversationId: string; workspaceId: string }`.
   Никаких полей с контентом — типы не должны позволять добавить текст/имена
   незаметно (без изменения схемы). Перевести клиент из `lib/inngest/client.ts`
   на эти схемы; убедиться, что существующая эмиссия из вебхука типизируется.
2. `lib/inngest/functions/generate-draft.ts` — скелет: подписан на
   `interaction/received`, один step, логирующий только ID из payload; экспорт
   через `lib/inngest/functions/index.ts` (реестр функций).
3. `app/api/inngest/route.ts`: `serve()` с клиентом и реестром функций (GET/POST/PUT
   по документации SDK).
4. Локальный dev-контур: краткая инструкция в README (или `docs/`-заметке рядом с
   кодом): `supabase start` + `next dev` + `npx inngest-cli dev` — Dev Server
   обнаруживает приложение по `/api/inngest`.
5. Тесты: юнит на схемы (компиляция типов: payload с лишним полем-контентом не
   типизируется — через `@ts-expect-error`); смоук на то, что реестр функций
   экспортирует `generate-draft` и роут собирается.

## Критерии приёмки

- [ ] `app/api/inngest/route.ts` существует по §12 и регистрирует функции из `lib/inngest/functions/`
- [ ] Схемы событий типизированы; payload обоих событий — только ID (правило 7), попытка добавить контент ловится компилятором (`@ts-expect-error`-тест)
- [ ] Локально: отправка фикстуры Zernio в вебхук-роут → событие видно в Inngest Dev Server и функция-скелет выполнена (лог с ID)
- [ ] Fail-safe эмиссия из вебхука (E-002/T-03) не сломана: вебхук отвечает 200 и при выключенном Dev Server
- [ ] Инструкция локального запуска (три процесса) записана

## Definition of Done

```
npm run lint
npm run build
npm test
```

Плюс ручная проверка: `supabase start` + `next dev` + `npx inngest-cli dev`,
отправить фикстуру в `POST /api/webhooks/zernio` (скрипт/curl из E-002) — в UI
Dev Server видны событие `interaction/received` и успешный запуск `generate-draft`
(скелет).

---

## 🔧 Отчёт разработчика

### Что сделано

- `lib/inngest/events.ts` — добавлены типизированные события
  `interaction/received` и `draft/regenerate.requested` с явным ID-only
  payload; существующая fail-safe эмиссия переведена на типизированный event.
- `lib/inngest/functions/generate-draft.ts` — добавлена функция-скелет с одним
  retriable step: структурированный лог и результат содержат только
  `messageId`, `conversationId`, `workspaceId`.
- `lib/inngest/functions/index.ts` — добавлен единый реестр функций.
- `app/api/inngest/route.ts` — добавлен Next.js App Router serve endpoint с
  `GET`, `POST`, `PUT` и регистрацией общего реестра.
- `lib/inngest/events.test.ts` — добавлены позитивные контракты обеих схем и
  `@ts-expect-error`-проверки запрета полей с контентом/именем; сохранены
  проверки точного набора ID и fail-safe эмиссии.
- `app/api/inngest/route.test.ts` — smoke-тест реестра и трёх route handlers.
- `README.md` — описан локальный контур из трёх процессов, обязательный для SDK
  v4 `INNGEST_DEV=1`, URL serve endpoint и воспроизводимая PowerShell-команда
  отправки подписанной Zernio-фикстуры на сидовый канал.

### Как проверено

- `npm.cmd run lint` — успешно, ошибок нет.
- `npm.cmd run build` — успешно; TypeScript и production build прошли,
  динамический маршрут `/api/inngest` присутствует в route manifest.
- `npx.cmd vitest run lib/inngest/events.test.ts app/api/inngest/route.test.ts`
  — успешно: 2 файла, 6 тестов.
- `npm.cmd test` — общий сьют выполнен, результат: 33 test files passed, 4
  skipped, 1 failed; 179 tests passed, 27 skipped, 2 failed. Оба падения —
  существующие `lib/realtime/inbox-sync.test.ts`: тестовый mock не содержит
  `supabase.auth.getSession`, поэтому ожидаемые `channel`/`removeChannel` не
  вызываются. Отдельный повтор этого файла воспроизводит те же 2 падения; он
  не импортирует и не затрагивает код T-01.
- Ручной сквозной прогон через Dev Server не выполнен: `npx.cmd supabase status`
  после разрешения записи telemetry завершился ошибкой подключения к
  `dockerDesktopLinuxEngine` — Docker Desktop в окружении не запущен. Без
  локальной БД вебхук-фикстура не может пройти до эмиссии события. Полная
  команда прогона записана в `README.md`.

### Отклонения

- Тикет называет `EventSchemas`, но установленный Inngest SDK `4.13.0` удалил
  этот API. По актуальной официальной документации v4 использованы
  `eventType()` + `staticSchema()` и typed event `.create()`: это сохраняет
  требуемую compile-time типизацию и делает лишние поля ошибкой TypeScript.
- Для локального запуска добавлен `INNGEST_DEV=1`: SDK v4 по умолчанию работает
  в cloud mode и без этого флага не подключается к локальному Dev Server.

### Вне скоупа и открытые вопросы

- Исправление двух существующих Realtime-тестов не относится к T-01 и не
  выполнялось.
- Бизнес-логика генерации, дебаунс, база знаний, категории и выбор LLM-провайдера
  не добавлялись: это скоуп последующих тикетов эпика.
- Открытых вопросов по реализации T-01 нет; ручной smoke остаётся повторить в
  окружении с запущенным Docker Desktop.

### Доработка 1

#### Что исправлено

- `lib/realtime/inbox-sync.test.ts` — тестовый Supabase mock актуализирован под
  действующий асинхронный контракт `auth.getSession()` →
  `realtime.setAuth(access_token)` → подписка. Ожидания также учитывают
  обязательный `system` listener; проверки трёх workspace-фильтров и удаления
  канала сохранены. Production-код Realtime не менялся, тесты не отключались и
  не ослаблялись.
- Отдельный новый сквозной Inngest smoke не добавлялся согласно принятому
  решению: Docker и Inngest Dev Server не являются блокером T-01. Профильные
  contract-тесты по-прежнему проверяют ID-only schemas, fail-safe helper,
  реестр функции и наличие `GET`/`POST`/`PUT` serve handlers. Ручной сценарий с
  реальной локальной БД и Inngest Dev Server остаётся воспроизводимо описан в
  `README.md`; общий ручной прогон эпика — в `T-08-executive-summary.md`, шаг 6.

#### Как проверено

- `npx.cmd vitest run lib/realtime/inbox-sync.test.ts` — успешно: 1 файл, 9
  тестов.
- `npx.cmd vitest run lib/inngest/events.test.ts app/api/inngest/route.test.ts`
  — успешно: 2 файла, 6 тестов.
- `npm.cmd test` — успешно: 34 test files passed, 4 DB-зависимых файла штатно
  skipped; 181 тест passed, 27 skipped, exit code 0.
- `npm.cmd run lint` — успешно, ошибок нет.
- `npm.cmd run build` — успешно; TypeScript и production build прошли, маршрут
  `/api/inngest` присутствует.

#### Отклонения и вне скоупа

- Docker-зависимый ручной прогон не выполнялся: по явному решению он не является
  блокером перехода при зелёных unit/contract тестах. Инструкция сохранена для
  окружения с Docker Desktop.
- Production-логика Realtime и остальные тикеты не изменялись.

## 🔍 Ревью

**Вердикт: CHANGES_REQUESTED**

1. Не выполнены критерий приёмки и ручная часть Definition of Done: сквозной
   прогон `POST /api/webhooks/zernio` → `interaction/received` → успешный запуск
   `generate-draft` в Inngest Dev Server не проводился. По этой же причине не
   подтверждён на реальном роуте критерий ответа 200 при выключенном Dev Server
   (юнит-тест проверяет только поглощение ошибки helper-функцией). Нужно провести
   оба сценария в окружении с работающим Docker/Supabase и зафиксировать результат
   в отчёте. Повторная проверка ревьюером `npx.cmd supabase status` не дошла до
   запуска: Docker Desktop Linux Engine недоступен.
2. Команда Definition of Done `npm.cmd test` завершается с кодом 1: 2 теста в
   `lib/realtime/inbox-sync.test.ts` падают из-за отсутствующего в mock
   `supabase.auth.getSession` (33 файла прошли, 4 пропущены, 1 упал; 179 тестов
   прошли, 27 пропущены, 2 упали). Падения не вызваны diff T-01, но заявленный
   DoD требует успешного выполнения всей команды. Нужно восстановить зелёный
   общий сьют либо согласованно изменить критерий DoD до повторного ревью.

Проверено ревьюером:

- `npm.cmd run lint` — успешно;
- `npm.cmd run build` — успешно, маршрут `/api/inngest` присутствует;
- `npx.cmd vitest run lib/inngest/events.test.ts app/api/inngest/route.test.ts`
  — успешно, 2 файла / 6 тестов;
- `npm.cmd test` — ошибка, результат приведён выше;
- фактический diff и прилегающий webhook-код — скоуп соблюдён, payload обоих
  событий содержит только ID, fail-safe helper сохранён; нарушений применимых
  правил вайбкодинга не обнаружено;
- API SDK v4 (`eventType` + `staticSchema`, typed `.create()`, `serve()` с
  `GET`/`POST`/`PUT`) соответствует актуальной официальной документации Inngest.
