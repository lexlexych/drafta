---
title: "12. Структура репозитория"
aliases: ["Структура репозитория", "Дерево каталогов", "Repo structure", "§9"]
tags: [architecture, repository, structure, nextjs, conventions]
chapter: 12
source_section: "9"
type: chapter
up: "[[_index]]"
prev: "[[11-realtime-pwa]]"
next: "[[13-environments-secrets]]"
related:
  - "[[03-stack]]"
  - "[[05-channels]]"
  - "[[07-data-flows]]"
  - "[[08-ai-subsystem]]"
  - "[[10-ui]]"
  - "[[11-realtime-pwa]]"
  - "[[14-vibecoding-rules]]"
created: 2026-07-19
updated: 2026-07-19
---

# 12. Структура репозитория

> [!info] Навигация
> ⬅️ [11. Realtime, Web Push, PWA](11-realtime-pwa.md) · ⬆️ [Оглавление](_index.md) · ➡️ [13. Окружения, секреты, деплой](13-environments-secrets.md)

```
app/
├── (auth)/                       # вход, регистрация, приём приглашения
├── (app)/
│   ├── dashboard/                # стартовый обзорный экран
│   ├── inbox/                    # ящик «Сообщения»
│   ├── comments/                 # ящик «Публикации»
│   ├── contacts/
│   ├── knowledge/                # база знаний (md-редактор)
│   └── settings/                 # каналы, AI, база знаний, шаблоны ответов, команда, уведомления, приватность
├── api/
│   ├── webhooks/[provider]/      # единый приёмник вебхуков
│   └── cron/                     # тики расписания из vercel.json
├── sw.ts                         # Serwist
lib/
├── channels/                     # types, registry, zernio/, postmark/, meta/(будущее)
├── workflows/                    # generate-draft, send-message, send-push, digest, ...
├── ai/                           # клиент LLM, сборка промпта и разбор ответа, masking.ts, бюджет базы знаний
└── db/                           # типизированные запросы; клиенты supabase (publishable/secret)
supabase/migrations/              # вся схема и RLS — только миграциями
CLAUDE.md                         # глоссарий §1.1 + правила §11
```

## Что где описано

| Каталог | Глава |
|---|---|
| `app/(app)/*` — экраны | [10. UI и навигация](10-ui.md) + [11. Realtime, Web Push, PWA](11-realtime-pwa.md) |
| `app/api/webhooks/[provider]/` | [7.1. Входящее](07-data-flows.md#61-входящее-dm-или-комментарий) |
| `lib/channels/` | [5. Слой абстракции каналов](05-channels.md) |
| `lib/workflows/` | [7.6. Список прогонов](07-data-flows.md#66-полный-список-прогонов), [18. Durable-исполнение](18-workflows.md) |
| `lib/ai/` (включая `masking.ts`) | [8. AI-подсистема](08-ai-subsystem.md) + [9. Категории и база знаний](09-categories.md) |
| `supabase/migrations/` | [6. Модель данных](06-data-model.md) |
| `CLAUDE.md` | [2. Глоссарий](02-glossary.md) + [14. Правила вайбкодинга](14-vibecoding-rules.md) |

> [!danger] Границы, которые нельзя нарушать
> - Провайдер-специфичный код — **только** в `lib/channels/` ([§5](05-channels.md#дисциплина)).
> - Вызовы LLM — **только** через `lib/ai` ([§8](08-ai-subsystem.md)).
> - Схема БД меняется **только** миграциями в `supabase/migrations/`, никаких правок через дашборд.

---

⬅️ [11. Realtime, Web Push, PWA](11-realtime-pwa.md) · ⬆️ [Оглавление](_index.md) · ➡️ [13. Окружения, секреты, деплой](13-environments-secrets.md)
