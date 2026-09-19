---
id: T-06
epic: E-004
title: "Push, фото и очистки: пять Workflow и два защищённых Cron"
type: dev
status: todo
depends_on: [T-02, T-04, T-05]
created: 2026-09-19
updated: 2026-09-19
---

# T-06. Push, фото и очистки: пять Workflow и два защищённых Cron

## Цель

Пять фоновых функций перенесены, push и очистки имеют максимум два автоматических повтора, фото обновляются вручную после ошибки.

## Контекст

[План, §2, §4–7](../../plans/inngest-to-vercel-workflow.md), [PWA](../../architecture/11-realtime-pwa.md), [публикации](../../architecture/18-publication-authoring.md), [потоки](../../architecture/07-data-flows.md), [модель](../../architecture/06-data-model.md), [окружения](../../architecture/13-environments-secrets.md), T-02. Подтверждено пользователем: до двух дополнительных попыток только push и двум очисткам.

Общие обязательные источники: [глоссарий](../../architecture/02-glossary.md), [правила](../../architecture/14-vibecoding-rules.md). Прямое решение пользователя заменяет требования Inngest и автоматических retry: основное приложение переходит на Vercel Workflow; архитектуру синхронизирует T-07. `website/` исключён из изменений.

## Шаги реализации

1. Создать sendPushWorkflow, syncContactAvatarWorkflow, syncPostThumbnailWorkflow, cleanupAiRequestLogWorkflow, cleanupPublicationAssetsWorkflow. Переключить существующие webhook/прочие emitters; сохранить durable intent и быстрый приём вебхука.
2. Push выполнять по подписке: успех checkpoint, временная ошибка до 2 retries с ограниченным сроком актуальности; 404/410 удалить подписку без retry. Не повторять успешно уведомлённые устройства. Постоянная ошибка не маскируется успехом.
3. Аватар и миниатюра: maxRetries = 0, отличать отсутствующее фото от ошибки загрузки; сохранить freshness checks, добавить авторизованные actions и кнопки «Обновить фото»/«Обновить миниатюру» при ошибке, дедуплицировать одновременные обращения.
4. Добавить два Cron endpoint под CRON_SECRET и vercel.json: AI cleanup `0 3 * * *`, publication cleanup `17 * * * *`, UTC. Дубликат schedule безопасен, пересекающиеся cleanup не удаляют данные гонкой. Cron стартует Workflow, тяжёлая работа внутри steps.
5. Сохранить 30 дней AI retention с фиксированным cutoff; публикационная очистка ограниченными партиями удаляет только orphan paths/метаданные, истёкшие grants и завершённые imports/jobs старше 30 дней. Активные данные и используемые assets не удалять.
6. Cleanup временные шаги максимум 2 дополнительных retries, затем видимый оператору безопасный сигнал существующим способом наблюдения; расписание следующего запуска сохраняется. Подключить T-02 reconciliation для фоновых зависших операций, не добавляя скрытый retry пользовательских задач.

## Критерии приёмки

- [ ] Все пять Workflow зарегистрированы и вызываются; старые соответствующие emitters больше не отправляют Inngest события.
- [ ] Тест счётчика даёт максимум 3 обращения на временно неуспешную подписку/cleanup step; 404/410 и постоянные ошибки не retry; успешные устройства не уведомлены повторно.
- [ ] Ошибки avatar/thumbnail видны на соответствующем экране с рабочей кнопкой ручного обновления; отсутствие картинки у провайдера не выдаётся за сбой.
- [ ] Cron требует корректный Bearer CRON_SECRET, два расписания точны; endpoint не выполняет уборку напрямую; повтор одного schedule и перекрытие запусков безопасны.
- [ ] SQL/Storage фикстуры доказывают сохранность активных данных и 30-дневную ретенцию; повтор шага идемпотентен.
- [ ] Фоновые terminal failures наблюдаемы, контент и endpoints не попадают в Workflow history/логи. Нового несуществовавшего webhook cleanup или digest не добавлено. Также не создавать не зарегистрированные regenerate-draft/reconcile-webhooks.

## Definition of Done

`pnpm exec vitest run <push/avatar/thumbnail/cleanup/cron/UI tests>`, `pnpm exec supabase test db` при изменении SQL, `pnpm exec tsc --noEmit`, `pnpm lint`; smoke partial push failure, двух Cron и ручного обновления фото. Обязательный smoke после фичи: `pnpm exec vitest run 'app/(app)/(shell)/smoke.test.tsx' --maxWorkers=1 --no-file-parallelism`.

---

## 🔧 Отчёт разработчика

_Заполняется агентом-разработчиком: что сделано (файлы), как проверено
(команды и результат), отклонения, «вне скоупа», вопросы._

## 🔍 Ревью

_Заполняется агентом-ревьюером: вердикт APPROVED / CHANGES_REQUESTED,
замечания, что прогнано и с каким результатом._

