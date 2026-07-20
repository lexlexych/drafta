import { appDescription, appName } from "@/lib/app-metadata";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>{appName}</h1>
        <p>{appDescription}</p>
      </main>
    </div>
  );
}
