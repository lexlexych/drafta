---
id: T-05
epic: E-004
title: "Публикации: генерация и импорт с checkpoint, отправка со сверкой"
type: dev
status: done
depends_on: [T-02, T-03, T-04]
created: 2026-09-19
updated: 2026-09-21
---

# T-05. Публикации: генерация и импорт с checkpoint, отправка со сверкой

## Цель

Генерация, импорт и публикация работают через Workflow, сохраняют завершённые этапы и дают безопасный ручной повтор.

## Контекст

[План, §4–6](../../plans/inngest-to-vercel-workflow.md), [создание публикаций](../../architecture/18-publication-authoring.md), [модель](../../architecture/06-data-model.md), [каналы](../../architecture/05-channels.md), [AI](../../architecture/08-ai-subsystem.md), [GDPR](../../architecture/15-compliance-gdpr.md), T-02/T-03. Использовать текущие lib/publications, job/import/delivery статусы и UI.

Общие обязательные источники: [глоссарий](../../architecture/02-glossary.md), [правила](../../architecture/14-vibecoding-rules.md). Прямое решение пользователя заменяет требования Inngest и автоматических retry: основное приложение переходит на Vercel Workflow; архитектуру синхронизирует T-07. `website/` исключён из изменений.

## Шаги реализации

1. Перенести publication-generation → generatePublicationWorkflow, publication-import → importPublicationWorkflow, publication-send → publishPublicationWorkflow. Переключить реальные routes/actions, соблюдая engine ownership T-02.
2. Генерацию идей/outline/текста/изображений/карусели разбить по сохранённым результатам в Supabase; шаги принимают/возвращают IDs, не контент. Failed stage повторяется вручную; готовые слайды не генерируются повторно. Проверять revision, author, выбранный контекст и attempt при записи.
3. Импорт сохраняет прогресс отдельных файлов, параллельность не более текущей (три), allowlist/HTTPS/no redirects/байтовые и format limits. Соблюсти 270 секунд, истечение ссылок и текущую защиту от overwrite ручной редакции. После истечения/удаления payload UI требует свежий импорт.
4. Публикация работает на одну delivery выбранного канала. Сохранить first_sent_at, remote ID и срок провайдерной идемпотентности; различить подготовку медиа, provider send, фиксацию. Не повторять успешный канал из-за ошибки другого.
5. Разделить текущий runPublicationDelivery: status check только читает provider state и сохраняет итог; retry публикации — отдельное пользовательское действие с проверками uncertain. Перед переносом подтвердить контракт адаптера и не обещать отсутствующую идемпотентность.
6. Покрыть ошибки старта/шагов и UI recovery, исключить все скрытые автоматические retries бизнес-API. Санитизировать ошибки; URL/байты/промпты/результат генерации не выходят в Workflow history.

## Критерии приёмки

Ниже — итоговый acceptance, включая живое окружение; локальная реализация завершена, подтверждение полного сценария отмечается при T-08.

- [ ] Три workflow вызываются из текущего UI/GPT API; на ошибке бизнес-шага только один внешний вызов и ручной retry.
- [ ] Ошибка карусели после готовых слайдов повторяет только незавершённое; старый attempt не меняет новую редакцию.
- [ ] Импорт сохраняет валидные checkpoints и ограничения безопасности; истёкшие URL требуют свежей передачи, ручная редакция не затирается.
- [ ] В мультиканальной отправке успешная delivery не повторяется; status check не вызывает provider publish/retry даже при failed статусе.
- [ ] Таймаут или success + DB failure оставляет uncertain с безопасной сверкой; keys/first_sent_at/remote IDs не теряются при новом run.
- [ ] Workflow history содержит только IDs/технические состояния; тесты проверяют отсутствие URL, текста и байтов в inputs/outputs/errors.

## Definition of Done

`pnpm exec vitest run lib/publications <workflow и UI tests>`, `pnpm exec supabase test db` (publication + workflow SQL tests), `pnpm exec tsc --noEmit`, `pnpm lint`; smoke ошибки слайда/импорта и публикации в два канала с одной неуспешной delivery. Обязательный smoke после фичи: `pnpm exec vitest run 'app/(app)/(shell)/smoke.test.tsx' --maxWorkers=1 --no-file-parallelism`.

---

## 🔧 Отчёт разработчика

Три Workflow публикаций подключены к существующим API. Генерация разделена на этапы, импорт сохраняет ID готовых файлов; ручной повтор сохраняет checkpoints. Истёкшие ссылки требуют свежего импорта. Отправки с неизвестным исходом сверяются без нового publish; check_only не вызывает retry провайдера. Recovery выполняется перед повтором зависшего задания.

Проверки и ограничения общего интеграционного прогона записаны в [T-08](T-08-executive-summary.md#результаты-локальных-проверок-2026-09-21). Непроверенные живые сценарии остаются критериями ручного acceptance.

## 🔍 Ревью

APPROVED для локального dev-контура с ограничениями T-08. Проверка выполнена текущей сессией по коду, SQL и тестам; независимого ревью другим агентом не было. Живые SDK/Supabase/provider проверки и облачный cutover не объявляются выполненными.
