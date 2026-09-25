/**
 * Совет на карточке «Тебя поймали!» (CHILD_UX, часть 4): один, картинкой и короткой фразой,
 * без чисел и без упрёка. Причину берём из состояния комнаты в момент поимки.
 */
export type CaughtTipKind = 'cannon' | 'repair' | 'door' | 'strong';

export interface CaughtTip {
  kind: CaughtTipKind;
  text: string;
}

export interface CaughtTipInput {
  /** Сколько пушек было в комнате. */
  cannons: number;
  /** Уровень двери. */
  doorLevel: number;
  /** Во время последней осады ключ был готов, дверь мигала, а его так и не нажали. */
  missedRepair: boolean;
  /** Конфет хватало на улучшение двери. */
  couldUpgradeDoor: boolean;
}

/** Дверь этого уровня и ниже — «слабая» для совета «Сделай дверь крепче». */
const WEAK_DOOR = 2;

/** Одно — самое полезное — действие на следующий раз. Порядок = чему учит обучение. */
export function caughtTip(s: CaughtTipInput): CaughtTip {
  if (s.cannons === 0) return { kind: 'cannon', text: 'Поставь пушку у двери!' };
  if (s.missedRepair) return { kind: 'repair', text: 'Чини, когда дверь мигает!' };
  if (s.doorLevel <= WEAK_DOOR || s.couldUpgradeDoor) return { kind: 'door', text: 'Сделай дверь крепче!' };
  return { kind: 'strong', text: 'Призрак был очень сильный!' };
}
