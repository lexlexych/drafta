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
   supabase link --project-ref <dev-project-ref>
   supabase db push --dry-run
   supabase db push --include-seed
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
ошибкой, если отсутствует обязательная конфигурация, передан
`sb_secret_` ключ в `RLS_TEST_SUPABASE_PUBLISHABLE_KEY`, либо удалённый запуск
не подтверждён явно.

После `supabase db push --include-seed` задайте в PowerShell только значения
выделенного dev-проекта:

```powershell
$env:RLS_TEST_TARGET = "cloud-dev"
$env:RLS_TEST_REMOTE_CONFIRMATION = "cloud-dev-only"
$env:RLS_TEST_SUPABASE_URL = "https://<dev-project-ref>.supabase.co"
$env:RLS_TEST_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_<dev-key>"
$env:RLS_TEST_USER_A_PASSWORD = "drafta-demo-password"
$env:RLS_TEST_USER_B_PASSWORD = "drafta-demo-password"
npm run test:rls
```

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
supabase start
supabase db reset
npm run dev
```

`supabase db reset` последовательно применяет миграции и
`supabase/seed.sql`. Для локального запуска RLS-сьюта получите URL и
publishable-ключ из `supabase status`, затем используйте те же пароли выше и
следующую безопасную конфигурацию:

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

## Статические проверки

```powershell
npm run lint
npm run build
npm test
```

`npm test` включает статический контракт сидов и fail-fast валидацию конфигурации
RLS, но не подключается к Supabase. Runtime-проверка RLS выполняется только
отдельной командой `npm run test:rls` с явными переменными выше.
