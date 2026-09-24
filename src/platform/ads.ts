/**
 * Реклама за награду (воскрешение). Пока без Yandex SDK — заглушка:
 * в сборке для игроков ролика нет, и кнопка «Реклама → вернуться» не показывается;
 * в разработке ролик имитируется, чтобы проверить весь путь.
 *
 * При подключении SDK (см. чек-лист в docs/plans/2026-09-24-buildings-gate-ghost-spirit.md):
 * `ysdk.adv.showRewardedVideo({ callbacks: { onRewarded, onClose, onError } })`,
 * награда — только в onRewarded; на время ролика игра и звук на паузе (правило 4.7).
 */

/** Можно ли сейчас предложить ролик за награду. */
export function rewardedAvailable(): boolean {
  return import.meta.env.DEV;
}

/** Показать ролик. true — досмотрен, награду выдавать; false — закрыт/ошибка, вернуться к выбору. */
export function showRewarded(): Promise<boolean> {
  if (!import.meta.env.DEV) return Promise.resolve(false);
  return new Promise((resolve) => setTimeout(() => resolve(true), 1000));
}
