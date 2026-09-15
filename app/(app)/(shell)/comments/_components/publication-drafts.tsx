"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated media stays behind the workspace proxy. */

/**
 * Группа «Черновики» в левой панели публикаций: материалы Drafta, ещё не
 * ставшие постами в соцсетях (или с их статусами отправки).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { PublicationDraft } from "@/lib/publications/types";

import { CarouselIcon, ChevronIcon, PictureIcon, TextIcon, VideoIcon } from "../../_components/icons";
import panes from "../../_components/panes.module.css";
import styles from "./publication-list.module.css";
import { DeletePublication } from "./publication-publish";

export type PublicationFilter = "all" | "drafts" | "published" | "video" | "errors";

export const PUBLICATION_FILTERS: { id: PublicationFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "drafts", label: "Черновики" },
  { id: "published", label: "Опубликовано" },
  { id: "video", label: "Сценарии" },
  { id: "errors", label: "Ошибки" },
];

const KIND_LABELS: Record<PublicationDraft["kind"], string> = { image: "Пост с картинкой", carousel: "Карусель", text: "Текст", video: "Сценарий видео" };
const KIND_ICONS = { image: PictureIcon, carousel: CarouselIcon, text: TextIcon, video: VideoIcon };

async function api(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось загрузить черновики.");
  return data;
}

const failed = (d: PublicationDraft) => d.deliveries?.some(p => ["failed", "uncertain"].includes(p.status)) ?? false;
const published = (d: PublicationDraft) => d.deliveries?.some(p => p.status === "published") ?? false;

function matches(d: PublicationDraft, filter: PublicationFilter) {
  if (filter === "all") return true;
  if (filter === "video") return d.kind === "video";
  if (filter === "errors") return failed(d);
  if (filter === "published") return published(d);
  return d.kind !== "video" && !published(d);
}

function statusOf(d: PublicationDraft): { label: string; tone: "draft" | "ok" | "error" | "muted" } {
  if (failed(d)) return { label: "Ошибка отправки", tone: "error" };
  if (published(d)) return { label: "Опубликовано", tone: "ok" };
  if (d.deliveries?.length) return { label: "Отправляется", tone: "muted" };
  if (d.status === "importing") return { label: "Загрузка…", tone: "muted" };
  return { label: "Черновик", tone: "draft" };
}

function when(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "вчера";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
}

export function PublicationDrafts({ selectedId, filter, onCountChange }: { selectedId?: string | null; filter: PublicationFilter; onCountChange?: (count: number) => void }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<PublicationDraft[] | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () => { void api("/api/publications").then(data => { if (active) setDrafts(data.drafts ?? []); }).catch(() => {}); };
    refresh(); const timer = setInterval(refresh, 15000);
    window.addEventListener("publication-changed", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("publication-changed", refresh); };
  }, []);

  const visible = (drafts ?? []).filter(d => matches(d, filter));
  useEffect(() => { onCountChange?.(visible.length); }, [visible.length, onCountChange]);

  if (drafts === null) return null;
  if (!visible.length) {
    return ["all", "published"].includes(filter) ? null : <div className={panes.empty}>Нет материалов под выбранный фильтр.</div>;
  }

  return (
    <div className={styles.group}>
      <button type="button" className={styles.groupHead} aria-expanded={!collapsed} onClick={() => setCollapsed(v => !v)}>
        <ChevronIcon size={12} className={styles.groupChevron} />
        {filter === "published" ? "Материалы Drafta" : "Черновики"}
        <span className={styles.groupCount}>{visible.length}</span>
      </button>
      {!collapsed && visible.map(d => {
        const status = statusOf(d);
        const Icon = KIND_ICONS[d.kind] ?? PictureIcon;
        const cover = d.asset_ids?.[0];
        return (
          <div key={d.id} className={styles.draft} data-active={selectedId === d.id}>
            <Link className={styles.draftLink} href={`/comments?draft=${d.id}`} aria-current={selectedId === d.id ? "page" : undefined}>
              <span className={styles.thumb} aria-hidden="true">
                <Icon size={16} />
                {cover ? <img src={`/api/publications/assets/${cover}`} alt="" loading="lazy" draggable={false} onError={e => { e.currentTarget.style.display = "none"; }} /> : null}
                {d.kind === "carousel" && d.asset_ids.length > 1 ? <span className={styles.thumbCount}>{d.asset_ids.length}</span> : null}
              </span>
              <span className={styles.body}>
                <span className={styles.titleRow}>
                  <b>{d.title?.trim() || "Без названия"}</b>
                  <time dateTime={d.updated_at}>{when(d.updated_at)}</time>
                </span>
                <span className={styles.meta}>
                  <span className={styles.status} data-tone={status.tone}>{status.label}</span>
                  <span>{KIND_LABELS[d.kind]}</span>
                </span>
              </span>
            </Link>
            <DeletePublication
              draftId={d.id}
              variant="icon"
              onDeleted={() => { setDrafts(ds => (ds ?? []).filter(x => x.id !== d.id)); if (selectedId === d.id) router.push("/comments"); }}
            />
          </div>
        );
      })}
    </div>
  );
}
