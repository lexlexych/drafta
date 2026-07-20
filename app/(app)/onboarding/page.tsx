import { redirect } from "next/navigation";

import { getAuthenticatedUser, getCurrentWorkspace } from "@/lib/db/workspace";

import styles from "../app.module.css";
import { WorkspaceForm } from "./_components/workspace-form";

export default async function OnboardingPage() {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  const workspace = await getCurrentWorkspace(user.id);

  if (workspace) {
    redirect("/dashboard");
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.heading}>Создайте рабочее пространство</h1>
        <p className={styles.description}>
          Здесь будут собраны переписки и настройки вашей команды.
        </p>
        <WorkspaceForm />
      </section>
    </main>
  );
}
