# Статус проекта: эпики и тикеты

> Файл обновляется автоматически командами `/createEpic` и `/startEpic`
> (статусы меняет только оркестратор). Вручную не редактировать.
> Источник правды по каждому тикету — frontmatter его файла.

**Статусы тикетов:** `todo` · `in_progress` · `review` · `rework` · `done` · `blocked`
**Статусы эпиков:** `todo` · `in_progress` · `manual_steps` (ждёт ручных шагов) · `done` · `blocked`

## Сводка по эпикам

| Эпик | Название | Статус | Тикеты (done/всего) | Создан | Завершён |
|---|---|---|---|---|---|
| [E-001](epic_01/_index.md) | Фундамент: Next.js + Supabase Auth, схема БД v1, RLS | done | 7/8 | 2026-07-19 | 2026-07-20 |
| [E-002](epic_02/_index.md) | Zernio-контур: адаптер, вебхук, Realtime-инбокс «Сообщения» | done | 6/7 | 2026-07-19 | 2026-07-20 |
| [E-003](epic_03/_index.md) | AI-черновики с дебаунсом: Inngest + Mistral, generate-draft, панель черновика | manual_steps | 7/8 | 2026-07-19 | — |
| [E-004](epic_04/_index.md) | Миграция основного приложения с Inngest на Vercel Workflow | manual_steps | 7/8 | 2026-09-19 | — |

## E-001. Фундамент: Next.js + Supabase Auth, схема БД v1, RLS

Источник: [этап 0 плана внедрения](../architecture/16-rollout-plan.md#этап-0--фундамент-1-2-дня) · Эпик: [epic_01/_index.md](epic_01/_index.md)

| # | Тикет | Тип | Статус |
|---|---|---|---|
| T-01 | [Каркас Next.js-приложения и структура репозитория](epic_01/T-01-nextjs-scaffold.md) | dev | done |
| T-02 | [Схема БД v1 миграциями: все таблицы §6](epic_01/T-02-db-schema-v1.md) | dev | done |
| T-03 | [RLS-политики изоляции workspace](epic_01/T-03-rls-policies.md) | dev | done |
| T-04 | [Supabase Auth: регистрация, вход, сброс пароля](epic_01/T-04-supabase-auth.md) | dev | done |
| T-05 | [Создание workspace при онбординге и защищённая зона](epic_01/T-05-workspace-bootstrap.md) | dev | done |
| T-06 | [Сиды локальной разработки и автотесты RLS-изоляции](epic_01/T-06-seeds-rls-tests.md) | dev | done |
| T-07 | [UI-каркас приложения по макету ui-mockup.html на mock-данных](epic_01/T-07-ui-shell-mockup.md) | dev | done |
| T-08 | [Executive summary — ручные шаги](epic_01/T-08-executive-summary.md) | manual | todo |

## E-002. Zernio-контур: адаптер, вебхук, Realtime-инбокс «Сообщения»

Источник: [этап 1 плана внедрения](../architecture/16-rollout-plan.md#этап-1--zernio-контур-входящие-2-4-дня) · Эпик: [epic_02/_index.md](epic_02/_index.md)

| # | Тикет | Тип | Статус |
|---|---|---|---|
| T-01 | [Ядро слоя каналов: типы, интерфейс адаптера, реестр](epic_02/T-01-channels-core.md) | dev | done |
| T-02 | [Адаптер Zernio (DM): подпись, парсинг, фикстуры](epic_02/T-02-zernio-adapter.md) | dev | done |
| T-03 | [Вебхук-роут с идемпотентностью: пайплайн входящего](epic_02/T-03-webhook-inbound.md) | dev | done |
| T-04 | [Настройки → Каналы: подключения с именами](epic_02/T-04-channels-settings.md) | dev | done |
| T-05 | [Инбокс «Сообщения»: список диалогов и тред](epic_02/T-05-inbox-messages.md) | dev | done |
| T-06 | [Realtime-обновления инбокса](epic_02/T-06-realtime-inbox.md) | dev | done |
| T-07 | [Executive summary — ручные шаги](epic_02/T-07-executive-summary.md) | manual | todo |

## E-003. AI-черновики с дебаунсом: Inngest + Mistral, generate-draft, панель черновика

Источник: [этап 2 плана внедрения](../architecture/16-rollout-plan.md#этап-2--ai-черновики-с-дебаунсом-2-3-дня) · Эпик: [epic_03/_index.md](epic_03/_index.md)

| # | Тикет | Тип | Статус |
|---|---|---|---|
| T-01 | [Inngest-контур: serve-роут, типизация событий, локальный dev](epic_03/T-01-inngest-serve.md) | dev | done |
| T-02 | [Клиент LLM в lib/ai: Mistral с fallback на OpenRouter](epic_03/T-02-ai-client.md) | dev | done |
| T-03 | [Маскирование идентификаторов lib/ai/masking.ts + юнит-тесты](epic_03/T-03-masking.md) | dev | done |
| T-04 | [Сборка промпта по структуре §8 и debug-лог](epic_03/T-04-prompt-builder.md) | dev | done |
| T-05 | [generate-draft: дебаунс, пайплайн, supersede, регенерация](epic_03/T-05-generate-draft.md) | dev | done |
| T-06 | [Настройки → AI: форма реальных ai_settings](epic_03/T-06-ai-settings-form.md) | dev | done |
| T-07 | [Панель черновика в треде: реальные drafts + Realtime](epic_03/T-07-draft-panel.md) | dev | done |
| T-08 | [Executive summary — ручные шаги](epic_03/T-08-executive-summary.md) | manual | todo |

## E-004. Миграция основного приложения с Inngest на Vercel Workflow

Источник: [согласованный план миграции](../plans/inngest-to-vercel-workflow.md) · Эпик: [epic_04/_index.md](epic_04/_index.md)

| # | Тикет | Тип | Статус |
|---|---|---|---|
| T-01 | [Vercel Workflow SDK: сборка, регион и безопасные границы шагов](epic_04/T-01-workflow-runtime.md) | dev | done |
| T-02 | [Операции и попытки: атомарный запуск, блокировки, отмена и восстановление](epic_04/T-02-workflow-operations.md) | dev | done |
| T-03 | [Отправки DM и комментариев с ручным повтором и сверкой результата](epic_04/T-03-workflow-message-delivery.md) | dev | done |
| T-04 | [AI-черновик и автоответ: отмена, пауза и ручной повтор в переписке](epic_04/T-04-workflow-drafts-auto-reply.md) | dev | done |
| T-05 | [Публикации: генерация и импорт с checkpoint, отправка со сверкой](epic_04/T-05-workflow-publications.md) | dev | done |
| T-06 | [Push, фото и очистки: пять Workflow и два защищённых Cron](epic_04/T-06-workflow-background-jobs.md) | dev | done |
| T-07 | [Переключение основного приложения, удаление Inngest и актуальная документация](epic_04/T-07-workflow-cutover-docs.md) | dev | done |
| T-08 | [Executive summary — ручные шаги](epic_04/T-08-executive-summary.md) | manual | todo |

