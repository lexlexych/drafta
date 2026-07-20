import { redirect } from "next/navigation";

import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

import styles from "../app.module.css";

export default async function DashboardPage() {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (!workspace) {
    redirect("/onboarding");
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.heading}>Рабочее пространство</h1>
        <dl className={styles.details}>
          <div className={styles.detail}>
            <dt>Название</dt>
            <dd>{workspace.name}</dd>
          </div>
          <div className={styles.detail}>
            <dt>Email</dt>
            <dd>{user.email ?? "Не указан"}</dd>
          </div>
          <div className={styles.detail}>
            <dt>Роль</dt>
            <dd>{workspace.role}</dd>
          </div>
        </dl>

        <form action="/auth/sign-out" method="post">
          <button className={styles.button} type="submit">
            Выйти
          </button>
        </form>
      </section>
    </main>
  );
}
