# .ai/ — агентский workflow проекта drafta

Единый источник правды для разработки через AI-агентов. Платформо-нейтрален:
одни и те же процедуры выполняются в Claude Code, Codex CLI и любой другой среде,
которая умеет читать файлы репозитория.

## Карта файлов

```
AGENTS.md                     # точка входа: правила проекта + workflow (Codex читает нативно)
CLAUDE.md                     # адаптер Claude Code: импорт @AGENTS.md
.ai/
├── workflow.md               # процесс: роли, статусы, структура эпиков, правила
├── roles/                    # инструкции ролей (единственный экземпляр, без дублей)
│   ├── analyst.md            #   аналитик — создаёт эпики и тикеты
│   ├── developer.md          #   разработчик — выполняет один тикет
│   └── reviewer.md           #   ревьюер — проверяет тикет
├── commands/                 # процедуры команд (платформо-нейтральные)
│   ├── createEpic.md
│   └── startEpic.md
└── templates/                # шаблоны файлов эпика
    ├── epic-index.md
    ├── ticket.md
    └── executive-summary.md
.claude/
├── commands/                 # /createEpic и /startEpic в Claude Code (обёртки → .ai/commands/)
└── agents/                   # суб-агенты: epic-analyst, ticket-developer, ticket-reviewer
.codex/
└── prompts/                  # те же команды для Codex CLI (обёртки → .ai/commands/)
docs/epics/                   # сами эпики + STATUS.md (статус-борд)
```

Принцип: вся логика — в `.ai/`; файлы в `.claude/` и `.codex/` — тонкие обёртки,
которые только ссылаются на неё. Меняя процесс, правь `.ai/`, обёртки трогать не нужно.

## Как это работает в Claude Code

Ничего настраивать не нужно:

- `CLAUDE.md` импортирует `AGENTS.md`;
- `/createEpic` и `/startEpic` подхватываются из `.claude/commands/`;
- роли запускаются изолированными суб-агентами из `.claude/agents/`.

## Как это работает в Codex CLI

- `AGENTS.md` Codex читает автоматически — команды сработают, даже если написать их
  простым текстом в чате: `createEpic этап 0` или `/startEpic E-001`
  (правило перехвата описано в `AGENTS.md`).
- Чтобы работали настоящие слэш-команды, скопируйте промпты в домашнюю папку Codex
  (Codex загружает кастомные промпты из `~/.codex/prompts/`):

  ```powershell
  # Windows (PowerShell)
  New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\prompts" | Out-Null
  Copy-Item .codex\prompts\*.md "$env:USERPROFILE\.codex\prompts\"
  ```

  ```bash
  # macOS / Linux
  mkdir -p ~/.codex/prompts && cp .codex/prompts/*.md ~/.codex/prompts/
  ```

- Суб-агентов в Codex нет: сессия исполняет роли последовательно по файлам
  `.ai/roles/` — деградация описана в `.ai/workflow.md`, артефакты (тикеты,
  отчёты, статусы) получаются те же.

## Типовой цикл

1. `/createEpic этап 0` (или свободное описание) → аналитик создаёт
   `docs/epics/epic_01/` с тикетами и регистрирует эпик в `docs/epics/STATUS.md`.
2. `/startEpic E-001` → оркестратор по каждому тикету запускает разработчика,
   затем ревьюера; статусы обновляются после каждого перехода; при замечаниях —
   до 2 циклов доработки, дальше `blocked` и стоп.
3. Все dev-тикеты `done` → эпик в статусе `manual_steps`: человек выполняет шаги
   из `T-NN-executive-summary.md` (настройка Supabase, секреты и т.п.).
4. Повторный `/startEpic E-001` + подтверждение — эпик закрывается (`done`).

Прерывание не страшно: `/startEpic` всегда продолжает с первого незавершённого тикета.
