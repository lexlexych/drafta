---
id: T-01
epic: E-003
title: "Inngest-контур: serve-роут, типизация событий, локальный dev"
type: dev
status: todo
depends_on: []
created: 2026-07-19
updated: 2026-07-19
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

_Заполняется агентом-разработчиком: что сделано (файлы), как проверено
(команды и результат), отклонения, «вне скоупа», вопросы._

## 🔍 Ревью

_Заполняется агентом-ревьюером: вердикт APPROVED / CHANGES_REQUESTED,
замечания, что прогнано и с каким результатом._
