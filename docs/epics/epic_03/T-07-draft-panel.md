---
id: T-07
epic: E-003
title: "Панель черновика в треде: реальные drafts + Realtime"
type: dev
status: done
depends_on: [T-05]
created: 2026-07-19
updated: 2026-07-21
---

# T-07. Панель черновика в треде: реальные drafts + Realtime

## Цель

Панель AI-черновика в треде «Сообщения» (свёрстана в E-001/T-07 на mock-данных)
работает на реальных `drafts`: показывает `generating`/`ready`/`edited`-черновик,
появляется без перезагрузки по Realtime, действия работают — «править» сохраняет
`edited`, «отклонить» ставит `discarded`, «сгенерировать заново» запускает
регенерацию и заменяет черновик; «принять» остаётся заглушкой до этапа 3.

## Контекст

Обязательно прочитать перед выполнением:

- [10. UI и навигация — «Экраны инбокса»](../../architecture/10-ui.md#экраны-инбокса) — панель черновика: принять / править / отклонить / сгенерировать заново
- [6. Модель данных](../../architecture/06-data-model.md#drafts) — статусы черновика
- [11. Realtime, Web Push, PWA](../../architecture/11-realtime-pwa.md) — подписка на `drafts`
- [14. Правила вайбкодинга](../../architecture/14-vibecoding-rules.md) — правило 2 (публикация Realtime — только миграцией), правило 7 (эмиссия события регенерации — только ID)
- [16. План внедрения, этап 2](../../architecture/16-rollout-plan.md#этап-2--ai-черновики-с-дебаунсом-2-3-дня) — «панель черновика» в скоупе этапа

Существенные факты:

- Панель уже свёрстана (E-001/T-07): тред DM содержит панель на янтарной подложке
  с четырьмя действиями-заглушками. Этот тикет подключает данные и действия,
  вёрстку не переделывает. Панель в разделе «Комментарии» остаётся mock (этап 5).
- E-002/T-06 задал паттерн Realtime: таблицы добавляются в публикацию
  `supabase_realtime` **миграцией**, подписка — под RLS пользовательской сессии,
  с фильтром по workspace; `drafts` в публикацию тогда сознательно не включали —
  включить теперь.
- «Активный» черновик диалога — последний со статусом `generating`, `ready` или
  `edited`; `superseded`/`discarded` в панели не показываются (supersede приходит
  update-событием — панель должна его обработать).
- «Сгенерировать заново» — server action, эмитящий `draft/regenerate.requested`
  (схема из T-01, payload только ID); обработчик — T-05. Пока новый черновик
  генерируется, панель показывает состояние «генерируется» (`generating`-запись
  создаёт пайплайн).
- «Принять» — заглушка: кнопка видима, но помечена (tooltip/disabled) «отправка —
  этап 3» (открытый вопрос №3 эпика).
- Правка и отклонение — server actions под пользовательской сессией (RLS
  разрешает участнику workspace UPDATE); правка сохраняет текст и статус `edited`.

## Шаги реализации

1. Миграция: добавить `drafts` в публикацию `supabase_realtime`
   (+ `replica identity full`, если нужно для update-событий — по образцу E-002/T-06).
2. Server-загрузка активного черновика диалога вместе с тредом; типизированные
   запросы в `lib/db`.
3. Состояния панели: нет черновика → панель скрыта/пустое состояние; `generating` →
   индикатор «генерируется…»; `ready`/`edited` → текст + модель + действия.
   Замена mock-источника на реальные данные (mock для панели треда DM удалить
   из использования).
4. Realtime-подписка на `insert`/`update` в `drafts` текущего диалога (фильтр по
   workspace/conversation, под RLS): появление `ready` — панель обновляется без
   перезагрузки; `superseded`/`discarded` — черновик исчезает/заменяется.
5. Действия:
   - «править»: inline-редактирование текста → server action сохраняет текст и
     статус `edited`;
   - «отклонить»: server action → `discarded`, панель очищается;
   - «сгенерировать заново»: server action → `inngest.send("draft/regenerate.requested",
     { conversationId, workspaceId })`, payload только ID; UI ждёт Realtime;
   - «принять»: заглушка с пометкой «отправка — этап 3».
6. Мобильная компоновка: панель в треде на < 900px работает как в каркасе.
7. Тесты: юнит на редьюсер/обработчик Realtime-событий панели (ready появился,
   superseded скрылся); юнит на server actions (правка → `edited`, отклонение →
   `discarded`, регенерация эмитит событие только с ID); смоук рендера состояний
   панели.

## Критерии приёмки

- [ ] После генерации (T-05) черновик появляется в панели открытого треда без перезагрузки
- [ ] `generating` показывает индикатор; `ready`/`edited` — текст и действия; `superseded`/`discarded` не показываются
- [ ] «Править» сохраняет `edited` (видно в БД), «отклонить» ставит `discarded`, «заново» приводит к новому черновику в панели; «принять» — помеченная заглушка
- [ ] `drafts` добавлены в публикацию Realtime миграцией; подписка работает под RLS и отфильтрована по workspace (negative-проверка вторым пользователем из сидов)
- [ ] Событие регенерации содержит только ID (правило 7)
- [ ] Панель в «Комментариях» осталась mock и не сломана; мобильная компоновка работает
- [ ] Все тесты шага 7 написаны и проходят

## Definition of Done

```
supabase db reset   # миграция публикации
npm run lint
npm run build
npm test
```

Ручная проверка сквозного сценария (с T-05, мок-LLM или живой ключ): фикстура в
вебхук → в открытом треде появляется «генерируется…», затем текст черновика без
перезагрузки; правка/отклонение/заново работают; на мобильной ширине — тоже.

---

## 🔧 Отчёт разработчика

### Что сделано

- `supabase/migrations/20260722110000_enable_drafts_realtime.sql` добавляет
  `public.drafts` в `supabase_realtime`. `REPLICA IDENTITY FULL` не включён:
  панель использует полный `payload.new` INSERT/UPDATE, а старые значения и DELETE
  ей не нужны.
- `lib/db/drafts.ts`, `lib/drafts/types.ts`, `lib/db/inbox.ts` загружают вместе с
  DM-тредом последний workspace-scoped `generating`/`ready`/`edited` draft,
  сохраняют `kb_file_ids` и разрешают их в имена существующих `kb_files`.
  `discarded`/`superseded`/`sent` в активную панель не попадают.
- `app/(app)/(shell)/inbox/actions.ts` реализует RLS-scoped правку (`edited`),
  отклонение (`discarded`) и регенерацию. `lib/inngest/events.ts` эмитит
  `draft/regenerate.requested` только с `conversationId` и `workspaceId`; перед
  эмиссией диалог проверяется в workspace текущей пользовательской сессии.
- `lib/realtime/inbox-sync.ts` и
  `app/(app)/(shell)/_components/inbox-realtime-sync.tsx` расширяют существующий
  authenticated Realtime-канал подписками INSERT/UPDATE `drafts` с фильтром
  `workspace_id`; `lib/realtime/draft-panel.ts` дополнительно отсекает чужой
  workspace/conversation и сводит ready/generating/edited/terminal события в
  состояние открытой панели. После reconnect сохраняется штатный `router.refresh()`.
- `app/(app)/(shell)/_components/draft-panel.tsx` и inbox page переведены с DM mock
  на реальные данные: нет draft — панель скрыта, generating — индикатор, ready/edited
  — текст, модель, KB-файлы и действия. «Принять» явно disabled с пометкой
  «этап 3». Существующий mock-режим той же панели для «Комментариев» сохранён.
- Добавлены unit/smoke-контракты reducer, Realtime wiring, server actions,
  ID-only event, миграции и рендера состояний; устаревший inbox smoke теперь
  проверяет скрытую панель при отсутствии активного draft.

### Проверки

- Targeted: `npm.cmd test -- lib/realtime/draft-panel.test.ts
  lib/realtime/inbox-sync.test.ts app/(app)/(shell)/_components/draft-panel.test.tsx
  app/(app)/(shell)/inbox/actions.test.ts lib/inngest/events.test.ts
  lib/draft-panel-migration.test.ts` — **6 файлов, 27 тестов прошли**.
- `npm.cmd run lint` — **успешно, 0 ошибок**.
- `npm.cmd run build` — первый прогон выявил TypeScript narrowing ошибки в toast;
  после исправления повторный прогон **успешен**, production build и typecheck прошли.
- `npm.cmd test` — полный прогон завершился с двумя smoke-падениями: устаревшее
  ожидание mock-панели inbox исправлено этим тикетом после прогона; второе —
  существующий `settings page > renders the ai section with switches` использует
  общий mock Supabase без `.from()` и не относится к T-07. Остальные тесты прогона,
  включая новые T-07, прошли. По указанию оркестратора повторный полный прогон не
  выполнялся.
- `supabase db reset`, живой Inngest/Docker и ручной сквозной сценарий не запускались
  по явному решению пользователя. Миграция проверена статическим contract-тестом;
  изоляция live-handler покрыта отрицательными unit-кейсами чужого workspace и
  conversation.

### Отклонения и вне скоупа

- Отправка принятого черновика не реализована: кнопка остаётся явной заглушкой этапа 3.
- Comments продолжают работать на mock-данных, как требует этап 5.
- Новых внешних сервисов, ручных шагов и изменений grounded pipeline T-05
  (`categories`, `kb_files`, `kb_file_ids`, выбор Mistral/OpenRouter) нет.

## 🔍 Ревью

_Заполняется агентом-ревьюером: вердикт APPROVED / CHANGES_REQUESTED,
замечания, что прогнано и с каким результатом._
