---
title: "13. Окружения, секреты, деплой"
aliases: ["Окружения", "Секреты", "Деплой", "env", "§10"]
tags: [architecture, devops, deploy, vercel, supabase, secrets, env, postmark]
chapter: 13
source_section: "10"
type: chapter
up: "[[_index]]"
prev: "[[12-repo-structure]]"
next: "[[14-vibecoding-rules]]"
related:
  - "[[03-stack]]"
  - "[[04-multitenancy]]"
  - "[[08-ai-subsystem]]"
  - "[[12-repo-structure]]"
  - "[[15-compliance-gdpr]]"
  - "[[16-rollout-plan]]"
created: 2026-07-19
updated: 2026-07-19
---

# 13. Окружения, секреты, деплой

> [!info] Навигация
> ⬅️ [12. Структура репозитория](12-repo-structure.md) · ⬆️ [Оглавление](_index.md) · ➡️ [14. Правила вайбкодинга](14-vibecoding-rules.md)

## Деплой

- `git push` → Vercel (превью-окружения на PR = бесплатный staging)
- миграции — `supabase db push` (локально или шагом CI)
- Inngest подхватывает функции через интеграцию с Vercel

**Два проекта Supabase (оба в регионе Frankfurt):** prod и dev.
**Регион функций Vercel — fra1.** Обоснование региона —
[15. Compliance](15-compliance-gdpr.md#122-субпроцессоры-и-данные).

## Локальная разработка

```
supabase start
npx inngest-cli dev
+ туннель (cloudflared / ngrok) для вебхуков Zernio
```

## Разовая ручная настройка (не код)

1. Домен + DKIM/SPF в Postmark
2. Postmark как **custom SMTP** в Supabase Auth (prod-проект)
3. Поднять лимит auth-писем в Rate Limits под ожидаемый поток регистраций

> [!important] Без шага 2 в проде не работают регистрация, сброс пароля и приглашения.
> Подробнее — [3. Стек](03-stack.md) и [4. Приглашения](04-multitenancy.md#приглашения).
> Выполняется на [Этапе 0](16-rollout-plan.md#этап-0--фундамент-1-2-дня).

## Секреты (Vercel env)

| Переменная | Назначение |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL проекта |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | клиентский ключ, `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | серверный, `sb_secret_…` — **обходит RLS**, никогда не попадает в клиентский бандл; гейтвей Supabase дополнительно отклоняет его из браузера |
| `ZERNIO_API_KEY` | доступ к Zernio API ([5. Каналы](05-channels.md)) |
| `ZERNIO_WEBHOOK_SECRET` | проверка подписи вебхуков ([7.1](07-data-flows.md#61-входящее-dm-или-комментарий)) |
| `MISTRAL_API_KEY` | LLM ([8. AI-подсистема](08-ai-subsystem.md)) |
| `INNGEST_EVENT_KEY` | отправка событий |
| `INNGEST_SIGNING_KEY` | подпись вызовов функций |
| `VAPID_PUBLIC_KEY` | Web Push ([11. PWA](11-realtime-pwa.md#web-push)) |
| `VAPID_PRIVATE_KEY` | Web Push |
| `POSTMARK_TOKEN` | API-токен — для будущих `notify-existing-user` и email-канала. **SMTP-креды живут в дашборде Supabase, не в env приложения** |
| `CREDENTIALS_ENCRYPTION_KEY` | шифрование токенов каналов — на будущее для Meta ([`channel_connections`](06-data-model.md#channel_connections)) |

> [!danger] `SUPABASE_SECRET_KEY` обходит RLS
> Только серверный код. Правило зафиксировано в
> [`CLAUDE.md`](14-vibecoding-rules.md).

---

⬅️ [12. Структура репозитория](12-repo-structure.md) · ⬆️ [Оглавление](_index.md) · ➡️ [14. Правила вайбкодинга](14-vibecoding-rules.md)
