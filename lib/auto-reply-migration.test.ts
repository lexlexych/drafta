import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Переводы строк нормализуем: на Windows рабочая копия приезжает с CRLF
// (core.autocrlf), а ожидания ниже написаны через LF.
function readMigration(name: string): string {
  return readFileSync(
    join(process.cwd(), "supabase", "migrations", name),
    "utf8",
  ).replaceAll("\r\n", "\n");
}

const migration = readMigration("20260907100000_auto_reply.sql");

describe("auto reply migration contract", () => {
  it("keeps every new table workspace-scoped, cascaded and behind RLS", () => {
    // Правило 3 (docs/architecture/14-vibecoding-rules.md): новая таблица —
    // сразу с workspace_id, каскадом от workspace и политикой участника.
    for (const table of [
      "auto_reply_settings",
      "auto_reply_scenarios",
      "auto_reply_runs",
    ]) {
      expect(migration).toContain(`create table public.${table} (`);
      expect(migration).toContain(
        `alter table public.${table} enable row level security;`,
      );
      expect(migration).toContain(`revoke all on table public.${table} from anon;`);
    }

    expect(
      migration.match(
        /workspace_id uuid not null(?: unique)?\n?\s*references public\.workspaces\(id\) on delete cascade/g,
      ),
    ).toHaveLength(3);

    for (const policy of [
      "auto_reply_settings_member_access",
      "auto_reply_scenarios_member_access",
      "auto_reply_runs_member_read",
    ]) {
      expect(migration).toContain(`create policy ${policy}`);
    }
    expect(
      migration.match(
        /using \(\(select private\.is_workspace_member\(workspace_id\)\)\)/g,
      ),
    ).toHaveLength(3);
  });

  it("keeps the decision journal read-only for operators", () => {
    // Журнал пишет только Inngest под service_role: строка «мы решили ответить»
    // не должна появляться из браузера.
    expect(migration).toContain(
      "grant select on table public.auto_reply_runs to authenticated;",
    );
    expect(migration).toContain(
      "grant select, insert, update, delete on table public.auto_reply_runs to service_role;",
    );
    expect(migration).toContain("create policy auto_reply_runs_member_read\non public.auto_reply_runs\nfor select");
  });

  it("points scenarios and the fallback at a template of the same workspace", () => {
    // Композитный ключ, а не ссылка на один id: иначе сценарий мог бы сослаться
    // на шаблон чужого тенанта.
    expect(migration).toContain(
      "add constraint reply_templates_workspace_id_key unique (workspace_id, id)",
    );
    expect(
      migration.match(
        /references public\.reply_templates\(workspace_id, id\)\n\s*on delete set null \((?:fallback|reply)_template_id\)/g,
      ),
    ).toHaveLength(2);
  });

  it("separates «не отвечать» from «шаблон удалили»", () => {
    // NULL в ссылке появляется и сам, когда шаблон удаляют (on delete set
    // null), поэтому молчание по замыслу выражается отдельным значением.
    expect(migration).toContain("check (action in ('reply', 'ignore'))");
    expect(migration).toContain(
      "check (action <> 'ignore' or reply_template_id is null)",
    );
  });

  it("validates the examples list with an immutable helper", () => {
    // Подзапрос в CHECK запрещён, вызов immutable-функции — нет: та же схема,
    // что у private.is_language_text_map.
    expect(migration).toContain(
      "create or replace function private.is_text_list(value jsonb)",
    );
    expect(migration).toContain("immutable");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "grant execute on function private.is_text_list(jsonb)\n  to authenticated, service_role;",
    );
    expect(migration).toContain(
      "check (private.is_text_list(examples))",
    );
  });

  it("marks an auto reply on the message itself, by the message it answers", () => {
    // Значок «A» рисуют два экрана, и оба читают сообщения одним запросом —
    // признак живёт колонкой, а не join'ом к журналу.
    expect(migration).toContain("add column auto_reply_for_message_id uuid;");
    // Входящее автоответом быть не может — это не бизнес-правило кода, а форма
    // строки.
    expect(migration).toContain(
      "check (direction = 'outgoing' or auto_reply_for_message_id is null)",
    );
    // Один автоответ на входящее: два прогона, проснувшихся на одно сообщение,
    // не должны дать клиенту две реплики.
    expect(migration).toContain(
      "create unique index messages_auto_reply_for_message_id_key",
    );
    expect(migration).toContain("where auto_reply_for_message_id is not null;");
  });

  it("republishes the preview view with the new column", () => {
    // Вью перечисляет колонки явно (20260828130000), поэтому `*` её бы не
    // подхватил и значок в списке диалогов молча не появился бы.
    expect(migration).toContain(
      "create or replace view public.conversation_message_previews\nwith (security_invoker = on) as",
    );
    expect(migration).toContain(
      "  m.auto_reply_for_message_id\nfrom public.messages m",
    );
  });

  it("creates the auto reply atomically, with every refusal inside the lock", () => {
    expect(migration).toContain(
      "create function public.create_auto_reply_message(",
    );
    // Тот же `for update` на той же строке беседы, что берёт
    // accept_reply_for_send: ручная отправка и автоответ встают в очередь.
    expect(migration).toContain("for update");
    // 1. оператор ответил сам; 2. клиент прислал более свежее сообщение.
    expect(migration).toContain(
      "and message.direction = 'outgoing'\n      and message.created_at >= decided_created_at",
    );
    expect(migration).toContain(
      "and (message.created_at, message.id) > (decided_created_at, decided_for_message_id)",
    );
    expect(migration).toContain(
      "'pending',\n    decided_for_message_id\n  )",
    );
  });

  it("returns the message it already created instead of refusing a retry", () => {
    // Шаг Inngest может вставить сообщение и упасть до сохранения результата.
    // Без этой ветки повтор получил бы NULL, и автоответ навсегда завис бы в
    // pending, никуда не отправившись.
    expect(migration).toContain(
      "and message.auto_reply_for_message_id = decided_for_message_id;",
    );
    expect(migration).toContain(
      "if outgoing_message_id is not null then\n    return outgoing_message_id;",
    );
  });

  it("never resets the unread counter", () => {
    // Пользователь видит непрочитанным то, что не читал: автоответ не считается
    // просмотром. Счётчик трогают только bump_conversation_unread_count и
    // markConversationRead.
    expect(migration).not.toContain("unread_count");
  });

  it("bills the classification as its own AI operation", () => {
    // Дашборд агрегирует по паре (operation, surface): под чужим значением
    // расходы автоответов слились бы с классификацией черновиков.
    expect(migration).toContain(
      "check (operation in ('classification', 'draft', 'translation', 'auto_reply'))",
    );
    expect(migration).toContain(
      "alter table public.ai_usage drop constraint ai_usage_operation_check;",
    );
    expect(migration).toContain(
      "alter table public.ai_request_log drop constraint ai_request_log_operation_check;",
    );
  });

  it("keeps the journal readable after a scenario is deleted", () => {
    // Ссылка обнулится вместе со сценарием, поэтому название и ключ варианта
    // хранятся копией: иначе «почему тогда ушёл этот текст» не восстановить.
    expect(migration).toContain("scenario_name text,");
    expect(migration).toContain("template_body_key text,");
    expect(migration).toContain("decided_for_message_id uuid not null,");
  });

  it("never supersedes a draft the operator is writing", () => {
    // Ровно этим автоответ отличается от accept_reply_for_send: тот гасит живые
    // черновики, потому что оператор закрыл пачку входящих сам.
    // `superseded` в файле есть, но только как исход в журнале — «ответит
    // прогон более свежего входящего», а не как перевод черновика.
    expect(migration).not.toContain("status = 'superseded'");
    expect(migration).not.toContain("public.drafts");
  });

  it("hands the send RPC to service_role only", () => {
    // У оператора для отправки есть accept_reply_for_send; эту функцию зовёт
    // только Inngest.
    expect(migration).toContain(
      "revoke all on function public.create_auto_reply_message(uuid, uuid, uuid, text)\n  from public;",
    );
    expect(migration).toContain(
      "grant execute on function public.create_auto_reply_message(uuid, uuid, uuid, text)\n  to service_role;",
    );
    expect(migration).not.toContain(
      "grant execute on function public.create_auto_reply_message(uuid, uuid, uuid, text)\n  to authenticated",
    );
  });
});
