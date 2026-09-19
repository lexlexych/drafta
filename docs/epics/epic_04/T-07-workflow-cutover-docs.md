---
id: T-07
epic: E-004
title: "Переключение основного приложения, удаление Inngest и актуальная документация"
type: dev
status: todo
depends_on: [T-01, T-02, T-03, T-04, T-05, T-06]
created: 2026-09-19
updated: 2026-09-19
---

# T-07. Переключение основного приложения, удаление Inngest и актуальная документация

## Цель

Рабочий контур основного приложения целиком использует 13 Vercel Workflow; Inngest SDK удалён, эксплуатация и архитектура соответствуют реализации.

## Контекст

[План, §8–10](../../plans/inngest-to-vercel-workflow.md), [стек](../../architecture/03-stack.md), [потоки](../../architecture/07-data-flows.md), [PWA](../../architecture/11-realtime-pwa.md), [структура](../../architecture/12-repo-structure.md), [окружения](../../architecture/13-environments-secrets.md), [правила](../../architecture/14-vibecoding-rules.md), [GDPR](../../architecture/15-compliance-gdpr.md), [публикации](../../architecture/18-publication-authoring.md), все предыдущие тикеты. Пользователь прямо поручил миграцию и обновление правил; обновление соответствующей архитектуры в этом тикете разрешено вопреки обычному запрету роли разработчика. Это согласованное изменение, не повод повторно запрашивать разрешение.

Общие обязательные источники: [глоссарий](../../architecture/02-glossary.md), [правила](../../architecture/14-vibecoding-rules.md). Прямое решение пользователя заменяет требования Inngest и автоматических retry: основное приложение переходит на Vercel Workflow; архитектуру синхронизирует T-07. `website/` исключён из изменений.

## Шаги реализации

1. Проверить полную карту 14 исходных функций: 13 новых workflow, generate-comment-drafts удалена. Проверить все actions/routes/webhooks/cancel paths и middleware: нет Inngest dispatch и двойных запусков.
2. Подготовить конкретную процедуру cutover/drain и rollback в T-08: принятые Inngest run завершить/отменить со сверкой предметных статусов до новой версии; спящие автоответы, pending и uncertain проверить отдельно. Не удалять старый deployment, пока нужны его run. Удалённые операции/секреты в дашбордах выполняет человек.
3. Удалить основной app/api/inngest, клиент, события, регистрацию, SDK-specific errors и зависимость inngest с lockfile. Оставшуюся reusable бизнес-логику перенести из lib/inngest в предметные модули. Удалить переходные engine branches, если они больше не нужны конечной конфигурации; не ломать сохранённые сведения для сверки.
4. Обновить AGENTS.md, README.md, .env.example, актуальные архитектурные главы 03/07/11/12/13/14/15/18 и необходимые ссылки/схему 06, инструкции интеграций, app/privacy/page.tsx: Vercel выполняет и хранит историю, ID-only boundaries, manual retry, fra1 и Cron. Исторические отчёты эпиков не переписывать. Сведения о лендинге Inngest сохранить.
5. Пройти полный локальный smoke по всем группам и интеграционные проверки отказов. Добавить/обновить сквозной автоматизированный сценарий с моками или существующей staging-инфраструктурой; конкретные живые проверки и ограничения окружения записать в T-08.
6. Зафиксировать фактический итог (реальные workflows/API, пути Cron, конфигурация region/retention, команды и результаты). Обновить план как реализованный dev-контур, отделив оставшиеся ручные проверки; не объявлять production переключённым без выполнения ручных шагов.

## Критерии приёмки

- [ ] В основном коде, package.json/lockfile и runtime config нет Inngest SDK imports/dispatch/serve. `website/` не изменён; исторические упоминания допустимы.
- [ ] Все 13 workflow доступны реальным вызывающим путям; отсутствуют параллельные старые dispatch и legacy cancel routes.
- [ ] Пользовательские операции retry только вручную; push и две очистки до 2 дополнительных попыток; configured policy совпадает с UI/тестами/документами.
- [ ] Финальные проверки включают RLS, concurrency/fencing, cancellation, unknown sends, failed start/crash recovery, checkpoints и ID-only serialization.
- [ ] Архитектура и privacy описывают фактическую обработку данных и ограничения; инструкции SDK, local dev, cron/cutover/rollback самодостаточны.
- [ ] T-08 содержит точные deploy/env/DB/drain действия и критерии проверки региона cloud run; нет необоснованных вопросов, production подтверждается отдельно человеком.

## Definition of Done

`pnpm test`, `pnpm test:rls` и `pnpm exec supabase test db` только на разрешённом изолированном тестовом target (при его отсутствии — честный integration caveat в T-08), `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`. Поиск: `rg -n 'inngest|INNGEST' app lib package.json pnpm-lock.yaml next.config.ts proxy.ts vercel.json .env.example` — рабочие ссылки отсутствуют; исторические/поясняющие исключения перечислить. Сквозной smoke: входящее → инбокс → ручной черновик → ошибка отправки → ручной retry; дополнительно автоответ/отмена, комментарии/private reply, публикации, push и Cron. Недоступные облачные проверки не заменять обещанием успешного результата. Обязательный smoke после фичи: `pnpm exec vitest run 'app/(app)/(shell)/smoke.test.tsx' --maxWorkers=1 --no-file-parallelism`.

---

## 🔧 Отчёт разработчика

_Заполняется агентом-разработчиком: что сделано (файлы), как проверено
(команды и результат), отклонения, «вне скоупа», вопросы._

## 🔍 Ревью

_Заполняется агентом-ревьюером: вердикт APPROVED / CHANGES_REQUESTED,
замечания, что прогнано и с каким результатом._

