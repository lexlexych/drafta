/**
 * Заглушка `IntersectionObserver` для jsdom-тестов дозагрузки.
 *
 * jsdom его не реализует, а он — единственный триггер подгрузки и в списках
 * (`usePagedList`), и в тредах (`useThreadWindow`). Заглушка сразу сообщает, что
 * маячок виден: ровно тот случай, ради которого он и стоит на краю списка.
 */

import { vi } from "vitest";

export function installIntersectionObserver() {
  class ImmediateIntersectionObserver {
    constructor(private readonly callback: IntersectionObserverCallback) {}

    observe(target: Element) {
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }

    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);
}
