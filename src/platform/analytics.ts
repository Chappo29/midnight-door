/**
 * Воронка событий: шаги обучения, подсказки, начало матча.
 * Пока только в консоль разработчика; при интеграции SDK — цели Яндекс Метрики (`ym(id, 'reachGoal', name, data)`).
 */
export function track(name: string, data: Record<string, unknown> = {}): void {
  if (import.meta.env.DEV) console.debug('[track]', name, data);
}
