"use client";
/* eslint-disable @next/next/no-img-element -- Media is served by the authenticated workspace proxy. */

/**
 * Сетка изображений результата: слайды карусели или одна картинка поста.
 *
 * Порядок слайдов меняется перетаскиванием (dnd-kit: мышь, тач, клавиатура);
 * остальные действия — в меню «⋯» на плитке. Пункты «Сдвинуть влево/вправо»
 * дублируют перетаскивание для тех, кому оно неудобно.
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRef, useState } from "react";

import { ActionMenu } from "../../_components/action-menu";
import { ArrowLeftIcon, ArrowRightIcon, GripIcon, PlusIcon, TrashIcon, UploadIcon, WandIcon } from "../../_components/icons";
import styles from "./slide-board.module.css";

const ACCEPT = "image/png,image/jpeg,image/webp";
export const MAX_SLIDES = 10;

type Props = {
  assetIds: string[];
  carousel: boolean;
  aspectRatio: string;
  disabled: boolean;
  /** Материал отправлен: без меню, перетаскивания и добавления. */
  readOnly?: boolean;
  onReorder: (ids: string[]) => void;
  onReplace: (index: number, file: File) => void;
  onAdd: (file: File) => void;
  onRemove: (id: string) => void;
  onRevise: (id: string) => void;
};

export function SlideBoard({ assetIds, carousel, aspectRatio, disabled, readOnly = false, onReorder, onReplace, onAdd, onRemove, onRevise }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ratio = aspectRatio.replace(":", " / ");

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(assetIds, assetIds.indexOf(String(active.id)), assetIds.indexOf(String(over.id))));
  }

  const tiles = assetIds.map((id, index) => (
    <SlideTile
      key={id}
      id={id}
      index={index}
      total={assetIds.length}
      carousel={carousel}
      ratio={ratio}
      disabled={disabled}
      readOnly={readOnly}
      onMove={(offset) => onReorder(arrayMove(assetIds, index, index + offset))}
      onReplace={(file) => onReplace(index, file)}
      onRemove={() => onRemove(id)}
      onRevise={() => onRevise(id)}
    />
  ));

  return (
    <div className={styles.board} data-single={!carousel || undefined}>
      {carousel ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={assetIds} strategy={rectSortingStrategy} disabled={disabled}>
            {tiles}
          </SortableContext>
        </DndContext>
      ) : tiles}
      {carousel && !readOnly && assetIds.length < MAX_SLIDES ? <AddTile ratio={ratio} disabled={disabled} onAdd={onAdd} /> : null}
    </div>
  );
}

function SlideTile({ id, index, total, carousel, ratio, disabled, readOnly, onMove, onReplace, onRemove, onRevise }: {
  id: string; index: number; total: number; carousel: boolean; ratio: string; disabled: boolean; readOnly: boolean;
  onMove: (offset: number) => void; onReplace: (file: File) => void; onRemove: () => void; onRevise: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: disabled || !carousel });
  const name = carousel ? `Слайд ${index + 1}` : "Изображение";

  return (
    <figure
      ref={setNodeRef}
      className={styles.tile}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition, aspectRatio: ratio }}
    >
      <img src={`/api/publications/assets/${id}`} alt={carousel ? `Изображение ${index + 1}` : "Изображение поста"} draggable={false} />
      {carousel ? <span className={styles.badge}>{index + 1}</span> : null}
      {readOnly ? null : <div className={styles.tools}>
        {carousel ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            className={styles.grip}
            aria-label={`Перетащить слайд ${index + 1}`}
            disabled={disabled}
            {...attributes}
            {...listeners}
          >
            <GripIcon />
          </button>
        ) : null}
        <ActionMenu
          label={`Действия: ${name.toLowerCase()}`}
          variant="overlay"
          items={[
            { label: "Изменить с AI", icon: <WandIcon />, onSelect: onRevise, disabled },
            { label: "Заменить своим…", icon: <UploadIcon />, onSelect: () => fileRef.current?.click(), disabled },
            carousel && { label: "Сдвинуть влево", icon: <ArrowLeftIcon />, onSelect: () => onMove(-1), disabled: disabled || index === 0 },
            carousel && { label: "Сдвинуть вправо", icon: <ArrowRightIcon />, onSelect: () => onMove(1), disabled: disabled || index === total - 1 },
            carousel && { label: "Удалить слайд", icon: <TrashIcon />, onSelect: onRemove, danger: true, disabled: disabled || total <= 2 },
          ]}
        />
      </div>}
      <input
        ref={fileRef}
        hidden
        type="file"
        accept={ACCEPT}
        aria-label={`Заменить: ${name.toLowerCase()}`}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) onReplace(file); event.target.value = ""; }}
      />
    </figure>
  );
}

function AddTile({ ratio, disabled, onAdd }: { ratio: string; disabled: boolean; onAdd: (file: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={styles.add}
      style={{ aspectRatio: ratio }}
      data-over={over || undefined}
      data-disabled={disabled || undefined}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { event.preventDefault(); setOver(false); const file = event.dataTransfer.files?.[0]; if (file && !disabled) onAdd(file); }}
    >
      <input
        type="file"
        accept={ACCEPT}
        disabled={disabled}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) onAdd(file); event.target.value = ""; }}
      />
      <span className={styles.addIcon}><PlusIcon size={16} /></span>
      <span>Добавить слайд</span>
      <small>PNG, JPEG, WebP · до 4 МБ</small>
    </label>
  );
}
