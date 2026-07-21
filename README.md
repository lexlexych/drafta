# drafta

PWA-инбокс для малого бизнеса: сообщения и комментарии из каналов в одном
`workspace`, с заделом под AI-черновики ответов. Архитектурные решения, термины
и правила разработки находятся в [AGENTS.md](AGENTS.md) и
[docs/architecture](docs/architecture/_index.md).

## Основной путь разработки: Supabase Cloud + Vercel (без Docker)

Этот путь подходит, когда локальный контейнерный рантайм недоступен. Используйте
отдельный проект **Supabase Cloud dev** в регионе Frankfurt; production-проект
для сидов и RLS-тестов не используется.

1. Создайте Cloud dev-проект по ручному шагу T-08, затем скопируйте
   `.env.example` в незакоммичиваемый `.env.local`. Впишите URL и
   publishable-ключ dev-проекта; `SUPABASE_SECRET_KEY` остаётся только в
   серверном окружении и никогда не передаётся RLS-тестам.
2. Свяжите CLI именно с dev-проектом и сначала проверьте план миграций:

   ```powershell
   npx supabase link --project-ref <dev-project-ref>
   npx supabase db push --dry-run
   npx supabase db push --include-seed
   ```

   `--include-seed` допустим только для выделенного dev-проекта: он применяет
   миграции и `supabase/seed.sql` с демо-данными. Для production применяется
   только `supabase db push` **без** `--include-seed`. Не выполняйте
   `supabase db reset --linked` без отдельного явного решения: команда
   разрушительна для связанного Cloud-проекта.
3. Запустите приложение:

   ```powershell
   npm run dev
   ```

4. Для Vercel подключите репозиторий и задайте регион функций **fra1**. В
   Environment Variables укажите `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` и серверный
   `SUPABASE_SECRET_KEY`; значения не коммитятся. Деплой Vercel не заменяет
   `supabase db push`: миграции применяются отдельно сначала к dev, затем по
   ручной процедуре T-08 к production.

Подробные ручные шаги для Frankfurt, Vercel и production находятся в
[T-08](docs/epics/epic_01/T-08-executive-summary.md).

## Проверка RLS в Cloud dev

`npm run test:rls` — отдельный интеграционный сьют. Он создаёт три клиента
`supabase-js` только с publishable-ключом: два входят под сид-пользователями,
третий остаётся анонимным. Перед любым сетевым запросом сьют завершается с
ошибкой, если отсутствует обязательная конфигурация. Он принимает только
непустой современный opaque-ключ с префиксом `sb_publishable_`: произвольные
строки, legacy `anon`/`service_role` JWT и `sb_secret_` ключи отклоняются до
создания клиента. Точный внутренний формат opaque-ключа намеренно не
дублируется в приложении.

После `npx supabase db push --include-seed` внесите точный ref выделенного
dev-проекта в versioned allowlist
[`lib/rls-test-targets.ts`](lib/rls-test-targets.ts) отдельным проверяемым
изменением. Пустой allowlist — безопасное состояние по умолчанию: Cloud-сьют
завершится до сети. Затем задайте в PowerShell только значения этого проекта:

```powershell
$env:RLS_TEST_TARGET = "cloud-dev"
$env:RLS_TEST_SUPABASE_URL = "https://<dev-project-ref>.supabase.co"
$env:RLS_TEST_REMOTE_CONFIRMATION = "cloud-dev:<dev-project-ref>"
$env:RLS_TEST_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_<dev-key>"
$env:RLS_TEST_USER_A_PASSWORD = "drafta-demo-password"
$env:RLS_TEST_USER_B_PASSWORD = "drafta-demo-password"
npm run test:rls
```

`RLS_TEST_SUPABASE_URL` должен в точности равняться URL ref из checked-in
allowlist, а подтверждение — `cloud-dev:<тот же ref>`. Переменные окружения не
могут расширить allowlist, поэтому production-ref без явного reviewed-изменения
в проекте также отклоняется до сетевого запроса.

Фикстуры сидов: `owner-a@example.com` и `owner-b@example.com`, у каждого свой
`workspace`. Сьют проверяет видимость каждой засеянной таблицы только в своём
`workspace`, запрет INSERT/UPDATE в чужой `workspace`, отсутствие доступа у
anon и server-only доступ к `webhook_events`. Отрицательные проверки используют
временные контакты и пытаются удалить их в обоих test-workspace; всё равно не
запускайте сьют против production.

## Локальный Supabase (опционально, требует Docker)

Архитектура сохраняет поддерживаемый локальный путь, но он требует установленный
Supabase CLI и Docker/совместимый container runtime. Этот репозиторий не запускает
Docker автоматически.

```powershell
npx supabase start
npx supabase db reset
npm run dev
```

`supabase db reset` последовательно применяет миграции и
`supabase/seed.sql`. Для локального запуска RLS-сьюта получите URL и
современный `sb_publishable_…` ключ из `supabase status`, затем используйте те
же пароли выше и следующую безопасную конфигурацию. Legacy `anon` JWT для этого
сьюта намеренно не принимается:

```powershell
$env:RLS_TEST_TARGET = "local"
$env:RLS_TEST_SUPABASE_URL = "http://127.0.0.1:54321"
$env:RLS_TEST_SUPABASE_PUBLISHABLE_KEY = "<local-publishable-key>"
$env:RLS_TEST_USER_A_PASSWORD = "drafta-demo-password"
$env:RLS_TEST_USER_B_PASSWORD = "drafta-demo-password"
npm run test:rls
```

Для `local` сьют принимает только loopback URL на порту `54321`; он не читает
обычные `NEXT_PUBLIC_*` переменные приложения, поэтому не может случайно
подключиться к настроенному Vercel/Supabase окружению.

## Локальный Inngest-контур

Для сквозной проверки вебхука и фоновой функции запустите три процесса в
отдельных терминалах из корня репозитория:

```powershell
# Терминал 1: локальная БД (требует Docker)
npx supabase start

# Терминал 2: Next.js в локальном режиме Inngest SDK v4
$env:INNGEST_DEV = "1"
npm run dev

# Терминал 3: Inngest Dev Server; UI откроется на http://localhost:8288
npx --ignore-scripts=false inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Dev Server также умеет автоматически обнаружить `/api/inngest`, но явный `-u`
делает запуск воспроизводимым. В UI должны появиться приложение `drafta` и
функция `generate-draft`. Для локальной фикстуры используйте то же значение
`ZERNIO_WEBHOOK_SECRET`, которое задано приложению. Сид локальной БД содержит
канал `seed-a-telegram`, поэтому PowerShell-команда ниже подменяет внешний ID
аккаунта в тестовом payload и подписывает в точности отправляемое тело:

```powershell
$fixtureBody = (Get-Content -Raw -Encoding utf8 lib/channels/zernio/__fixtures__/telegram-dm.json).Replace("acct_tg_98213", "seed-a-telegram")
$hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($env:ZERNIO_WEBHOOK_SECRET))
$signature = [Convert]::ToHexString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($fixtureBody))).ToLowerInvariant()
Invoke-WebRequest -Method Post -Uri http://localhost:3000/api/webhooks/zernio -ContentType application/json -Headers @{ "X-Zernio-Signature" = $signature } -Body $fixtureBody
```

После отправки в `POST /api/webhooks/zernio` событие
`interaction/received` должно завершиться успешным запуском единственного шага
`log-event-identifiers`; его лог содержит только `messageId`, `conversationId`
и `workspaceId`. Секреты `INNGEST_EVENT_KEY` и `INNGEST_SIGNING_KEY` локальному
Dev Server не нужны.

## Статические проверки

```powershell
npm run lint
npm run build
npm test
```

`npm test` включает статический контракт сидов и fail-fast валидацию конфигурации
RLS, но не подключается к Supabase. Runtime-проверка RLS выполняется только
отдельной командой `npm run test:rls` с явными переменными выше.
