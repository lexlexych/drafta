import type { AvatarView } from "@/lib/mock";

import styles from "./ui.module.css";

const SIZE_CLASSES = {
  sm: styles.avatarSm,
  md: styles.avatarMd,
  lg: styles.avatarLg,
} as const;

export function Avatar({
  avatar,
  size = "md",
}: {
  avatar: AvatarView;
  size?: keyof typeof SIZE_CLASSES;
}) {
  return (
    <span
      className={`${styles.avatar} ${SIZE_CLASSES[size]}`}
      // Фото из соцсети — фоном поверх цветного кружка, а не <img>: инициалы
      // остаются под картинкой, поэтому протухшая ссылка (прокси-роут ответит
      // 404) молча возвращает нас к буквам, без битой картинки и без
      // клиентского onError — компонент остаётся серверным.
      style={{
        background: `hsl(${avatar.hue} 42% 52%)`,
        ...(avatar.imageUrl
          ? {
              backgroundImage: `url("${avatar.imageUrl}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : {}),
      }}
      aria-hidden="true"
    >
      {avatar.initials}
    </span>
  );
}
