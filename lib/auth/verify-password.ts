import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "@/lib/db/env";

/**
 * Проверка текущего пароля перед его сменой. Клиент здесь одноразовый и
 * `persistSession: false`: `signInWithPassword` на cookie-клиенте перезаписал бы
 * сессию пользователя, а здесь токены не сохраняются никуда — ни удачная, ни
 * неудачная попытка не трогают ту сессию, из которой пришёл запрос.
 *
 * Ключ — publishable: секретный ключ живёт только в `lib/db/admin.ts`
 * (правило 5 AGENTS.md), и для проверки пароля он не нужен.
 */
export async function verifyUserPassword(
  email: string,
  password: string,
): Promise<boolean> {
  const { publishableKey, url } = getSupabasePublicConfig();
  const supabase = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  return !error;
}
