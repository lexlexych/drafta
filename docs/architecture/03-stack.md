---
title: "3. Стек"
aliases: ["Стек", "Технологии", "Stack", "§2"]
tags: [architecture, stack, nextjs, supabase, inngest, vercel, mistral, postmark, pwa]
chapter: 3
source_section: "2"
type: chapter
up: "[[_index]]"
prev: "[[02-glossary]]"
next: "[[04-multitenancy]]"
related:
  - "[[04-multitenancy]]"
  - "[[05-channels]]"
  - "[[07-data-flows]]"
  - "[[08-ai-subsystem]]"
  - "[[11-realtime-pwa]]"
  - "[[13-environments-secrets]]"
  - "[[15-compliance-gdpr]]"
created: 2026-07-19
updated: 2026-07-20
---

# 3. Стек

> [!info] Навигация
> ⬅️ [2. Глоссарий](02-glossary.md) · ⬆️ [Оглавление](_index.md) · ➡️ [4. Мультитенантность](04-multitenancy.md)

| Слой | Технология | Комментарий |
|---|---|---|
| Фронтенд + API | Next.js (App Router, TypeScript) | UI, API-роуты, вебхук-приёмники, код Inngest-функций |
| БД / Auth / Realtime / Storage | Supabase, **регион Frankfurt (eu-central)** | Регион выбирается при создании проекта и потом трудно меняется — решение первого дня. Новые API-ключи: `sb_publishable_` (клиент) и `sb_secret_` (сервер) |
| Фоновые задачи | Inngest | Генерация черновиков (включая **встроенный debounce**), отправка, ретраи. **Правило: в payload событий — только ID, никогда контент** ([§7.2](07-data-flows.md#62-дебаунс-и-генерация-черновика), [§15](15-compliance-gdpr.md)) |
| Хостинг | Vercel, **регион функций fra1 (Frankfurt)** | Один деплой через `git push` |
| PWA | Serwist (`@serwist/next`) | Сервис-воркер, установка, Web Push |
| Каналы (сейчас) | Zernio API | DM + комментарии для Telegram, WhatsApp, Facebook, Instagram; единые вебхуки; подключение аккаунтов — через OAuth-редирект внутри drafta (пользователь не заходит в дашборд Zernio, [5. Подключение аккаунта](05-channels.md#подключение-аккаунта-oauth)). DPA есть (выдаётся через их Trust Center под NDA) — **подписать до этапа 1**, см. [§15.2](15-compliance-gdpr.md#122-субпроцессоры-и-данные) |
| Транзакционная почта | Postmark | **Обязателен с первого дня как custom SMTP для Supabase Auth**: встроенная почта Supabase шлёт только участникам организации проекта (2 письма/час) — в проде без внешнего SMTP не работают регистрация, сброс пароля и инвайты. Позже этот же Postmark становится email-каналом (inbound). $15/мес за 10 000 писем, dev-план бесплатно |
| LLM | **Mistral (La Plateforme)**; резерв — **OpenRouter** | Европейский провайдер, обработка в ЕС, вне американской юрисдикции — ключевое для немецкого рынка. API OpenAI-совместимый: клиент в `lib/ai` остаётся стандартным SDK со сменным `baseURL`. Если `MISTRAL_API_KEY` не задан, клиент переключается на OpenRouter (`OPENROUTER_API_KEY` + модель по умолчанию `OPENROUTER_MODEL`) — [§8](08-ai-subsystem.md#резервный-провайдер--openrouter). Прочие альтернативы (Azure OpenAI EU Data Zone, локальная модель) — конфигурация, не код |

## Принцип

Один репозиторий, один язык, один основной деплой. Supabase хранит данные,
Inngest дирижирует фоновой работой, но весь исполняемый код живёт в Next.js-проекте
(см. [12. Структура репозитория](12-repo-structure.md)).

## Решения «первого дня»

Три выбора, которые дорого менять позже — их нельзя отложить:

1. **Регион Supabase = Frankfurt.** Задаётся при создании проекта, потом трудно меняется.
   Основание — [15. Compliance](15-compliance-gdpr.md#122-субпроцессоры-и-данные).
2. **Регион функций Vercel = fra1.** См. [13. Окружения и деплой](13-environments-secrets.md).
3. **Postmark как custom SMTP.** Без него в проде не работают регистрация, сброс пароля
   и приглашения — см. [4. Мультитенантность](04-multitenancy.md#приглашения).

> [!note] Postmark играет три роли
> SMTP для Auth (с этапа 0) → отправка писем существующим пользователям через API
> ([§4](04-multitenancy.md)) → полноценный email-канал
> ([§7.4](07-data-flows.md#64-email-этап-после-mvp)).
> Домен и DKIM настраиваются один раз и переиспользуются всеми тремя.

---

⬅️ [2. Глоссарий](02-glossary.md) · ⬆️ [Оглавление](_index.md) · ➡️ [4. Мультитенантность](04-multitenancy.md)
