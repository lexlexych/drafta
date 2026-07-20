import type { ReactNode } from "react";

import styles from "./auth.module.css";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className={styles.page}>
      <section className={styles.card}>{children}</section>
    </main>
  );
}
