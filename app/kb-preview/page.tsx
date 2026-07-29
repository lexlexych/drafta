import { KnowledgeBasePanel } from "../(app)/(shell)/settings/knowledge/knowledge-base-panel";

export default function KnowledgeBasePreviewPage() {
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", padding: 32 }}>
      <section style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontSize: 18, marginBottom: 28 }}>База знаний</h1>
        <p style={{ color: "var(--ink3)", fontSize: 13, marginBottom: 18 }}>
          Каждая категория — тема, по которой AI отвечает. Активные категории
          добавляются в системный промпт в указанном порядке; при превышении
          бюджета токенов часть из них не попадёт в контекст.
        </p>
        <KnowledgeBasePanel
          files={[
            {
              id: "about",
              name: "О мастерской",
              content: "# О мастерской\n\nTonwerk — керамическая мастерская в Берлине.",
              sort_order: 0,
              is_enabled: true,
              updated_at: "2026-07-21T10:00:00.000Z",
            },
            {
              id: "price",
              name: "Прайс",
              content: "# Прайс\n\n| Товар | Цена |\n| --- | ---: |\n| Чашка | 24 € |",
              sort_order: 1,
              is_enabled: true,
              updated_at: "2026-07-20T10:00:00.000Z",
            },
            {
              id: "faq",
              name: "Доставка",
              content: "# FAQ\n\n**Доставка:** 2–3 рабочих дня.",
              sort_order: 2,
              is_enabled: false,
              updated_at: "2026-07-19T10:00:00.000Z",
            },
          ]}
        />
      </section>
    </main>
  );
}
