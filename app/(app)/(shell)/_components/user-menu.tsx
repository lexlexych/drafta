"use client";

/**
 * Меню пользователя в подвале левого меню: переключение между workspace'ами,
 * создание нового и выход. Выход — обычный POST-форм на `/auth/sign-out`
 * (роут уже существует и принимает только POST), а не клиентский вызов
 * `supabase.auth.signOut()`.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Avatar } from "./avatar";
import { CheckIcon, ChevronIcon, LogoutIcon, PlusIcon } from "./icons";
import {
  createWorkspaceFromShellAction,
  switchWorkspaceAction,
  type WorkspaceActionResult,
} from "../workspace-actions";
import styles from "./shell.module.css";
import { useActivityTransition } from "./activity";

export type WorkspaceOption = {
  id: string;
  name: string;
};

export function UserMenu({
  userName,
  userRole,
  workspaces,
  currentWorkspaceId,
}: {
  userName: string;
  userRole: string;
  workspaces: WorkspaceOption[];
  currentWorkspaceId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useActivityTransition("Обновляем рабочее пространство…");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function toggleMenu() {
    setIsOpen((state) => !state);
    setIsCreating(false);
    setError(null);
  }

  function handleSwitch(workspaceId: string) {
    if (workspaceId === currentWorkspaceId) {
      setIsOpen(false);
      return;
    }

    setError(null);
    startTransition(async () => {
      // Успех действия заканчивается серверным редиректом — тогда оно
      // не возвращает результата.
      const result: WorkspaceActionResult | undefined =
        await switchWorkspaceAction(workspaceId);

      if (result && !result.ok) {
        setError(result.error);
      }
    });
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = newWorkspaceName.trim();

    if (!name) {
      setError("Введите название рабочего пространства.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result: WorkspaceActionResult | undefined =
        await createWorkspaceFromShellAction({ name });

      if (result && !result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <div className={styles.userMenu} ref={containerRef}>
      {isOpen ? (
        <div className={styles.userPopover}>
          <div className={styles.userPopoverTitle}>Рабочие пространства</div>

          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              className={styles.userMenuItem}
              data-active={workspace.id === currentWorkspaceId}
              disabled={isPending}
              onClick={() => handleSwitch(workspace.id)}
            >
              <span className={styles.userMenuIcon}>
                {workspace.id === currentWorkspaceId ? <CheckIcon /> : null}
              </span>
              <span className={styles.userMenuLabel}>{workspace.name}</span>
            </button>
          ))}

          {isCreating ? (
            <form className={styles.userMenuForm} onSubmit={handleCreate}>
              <input
                aria-label="Название нового рабочего пространства"
                autoFocus
                className={styles.userMenuInput}
                disabled={isPending}
                onChange={(event) => setNewWorkspaceName(event.target.value)}
                placeholder="Название"
                type="text"
                value={newWorkspaceName}
              />
              <button
                className={styles.userMenuSubmit}
                disabled={isPending}
                type="submit"
              >
                {isPending ? "Создаём…" : "Создать"}
              </button>
            </form>
          ) : (
            <button
              type="button"
              className={styles.userMenuItem}
              disabled={isPending}
              onClick={() => {
                setIsCreating(true);
                setError(null);
              }}
            >
              <span className={styles.userMenuIcon}>
                <PlusIcon />
              </span>
              <span className={styles.userMenuLabel}>Создать workspace</span>
            </button>
          )}

          {error ? (
            <p aria-live="polite" className={styles.userMenuError}>
              {error}
            </p>
          ) : null}

          <div className={styles.userMenuSeparator} />

          <form action="/auth/sign-out" method="post">
            <button className={styles.userMenuItem} type="submit">
              <span className={styles.userMenuIcon}>
                <LogoutIcon />
              </span>
              <span className={styles.userMenuLabel}>Выйти</span>
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        className={styles.userButton}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={toggleMenu}
      >
        <Avatar
          avatar={{ initials: userName.slice(0, 1).toUpperCase(), hue: 170 }}
          size="sm"
        />
        <span className={styles.userInfo}>
          <b>{userName}</b>
          <span>{userRole}</span>
        </span>
        <span className={styles.userChevron} data-open={isOpen}>
          <ChevronIcon />
        </span>
      </button>
    </div>
  );
}
