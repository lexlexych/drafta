/** Поле ручного ответа под панелью черновика; отправка — заглушка. */

import { SendIcon } from "./icons";
import { StubButton } from "./stub";
import styles from "./panes.module.css";

export function Composer({ placeholder }: { placeholder: string }) {
  return (
    <div className={styles.composer}>
      <input type="text" placeholder={placeholder} aria-label="Ответ" />
      <StubButton className={styles.sendButton} aria-label="Отправить">
        <SendIcon />
      </StubButton>
    </div>
  );
}
