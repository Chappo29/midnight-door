import { emptyProgress, normalizeProgress, type Progress } from './storage';
import { withTimeout, type YaPlayer, type YaSdk } from './yandex';

/**
 * Сохранение прогресса (SAVE_SYSTEM.md). Единственный источник правды — ProgressStore:
 * игра меняет прогресс только через него, он сразу пишет снимок локально (safeStorage Яндекса
 * или localStorage) и, если игрок вошёл в Яндекс, отправляет тот же снимок в облако (Player Data).
 *
 * Снимок целый: при расхождении локального и облачного выбираем один по ревизии, без слияния
 * полей (Math.max по монетам вернул бы потраченное).
 */

/** Ключ локального сохранения — тот же, что до этой системы. */
export const SAVE_KEY = 'midnight-door-progress';
/** Ключ Player Data в облаке Яндекса. */
export const CLOUD_KEY = 'save';
/** Звук раньше хранился отдельно; теперь это settings.muted внутри снимка. */
export const LEGACY_MUTE_KEY = 'midnight-door-muted';
/** Сюда кладём нечитаемое сохранение, прежде чем начать заново (чтобы можно было достать вручную). */
export const CORRUPT_KEY = 'midnight-door-progress-corrupt';
/** Сюда кладём локальный снимок, который проиграл облачному (на случай разбора обращения). */
export const REPLACED_KEY = 'midnight-door-progress-replaced';

/** 1 — старое сохранение без обёртки (Progress в корне); 2 — снимок с ревизией. */
export const SCHEMA_VERSION = 2;

export interface SaveSnapshot {
  /** Версия схемы. */
  v: number;
  /** Ревизия: +1 на каждое осмысленное изменение прогресса. Больше — новее. */
  rev: number;
  /** Время последнего изменения (мс). Решает только при равных ревизиях. */
  at: number;
  progress: Progress;
}

/** Хранилище ключ-значение: safeStorage Яндекса, localStorage или память. Остальной код не знает, какое. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Облачное сохранение. load — сырое значение (разбирает parseSnapshot), бросает при сбое сети. */
export interface CloudSave {
  load(): Promise<unknown>;
  save(snapshot: SaveSnapshot, flush: boolean): Promise<void>;
}

export type Log = (msg: string) => void;
const devLog: Log = (msg) => {
  if (import.meta.env.DEV) console.info(msg);
};

// ---------------- разбор и миграция ----------------

export interface ParsedSave {
  snapshot: SaveSnapshot | null;
  /** Данные были, но прочитать их не удалось. */
  corrupt: boolean;
  /** Старое сохранение без ревизии — мигрировано. */
  legacy: boolean;
}

const LEGACY_FIELDS = ['matches', 'wins', 'tutorial', 'hints', 'meta', 'unlocks'];
const nonNegInt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/**
 * Ревизия для сохранения без ревизии. Нельзя считать его ревизией 0: тогда любое облако
 * (даже пара действий на другом устройстве) перетёрло бы накопленное. Берём нижнюю оценку
 * числа записей, которые старая версия сделала за эту игру: каждое пройденное событие сохранялось.
 */
export function legacyRevision(p: Progress): number {
  const m = p.meta;
  return (
    1 +
    (p.tutorial ? 1 : 0) +
    (m.tutorialGift ? 1 : 0) +
    // Матч сохранял минимум дважды: начало ночи (усилители) и итоги.
    p.matches * 2 +
    p.hints.length +
    (m.heroes.length - 1) +
    (m.skins.door.length - 1) +
    (m.skins.cannon.length - 1) +
    (m.daily.last ? 1 : 0)
  );
}

/** Починенные поля поверх исходных: всё, чего эта версия не знает (на любой глубине), остаётся как было. */
function keepUnknown(raw: Record<string, unknown>, fixed: Progress): Progress {
  const merge = (r: unknown, f: unknown): unknown => {
    if (!r || typeof r !== 'object' || Array.isArray(r) || !f || typeof f !== 'object' || Array.isArray(f)) return f;
    const out: Record<string, unknown> = { ...(r as Record<string, unknown>) };
    for (const [k, v] of Object.entries(f as Record<string, unknown>)) out[k] = merge((r as Record<string, unknown>)[k], v);
    return out;
  };
  return merge(raw, fixed) as Progress;
}

/** Любое сохранение (строка JSON или объект из облака) → снимок текущей схемы. Не бросает. */
export function parseSnapshot(raw: unknown): ParsedSave {
  if (raw === null || raw === undefined || raw === '') return { snapshot: null, corrupt: false, legacy: false };
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { snapshot: null, corrupt: true, legacy: false };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { snapshot: null, corrupt: true, legacy: false };
  const o = data as Record<string, unknown>;
  if (typeof o.v === 'number') {
    if (!o.progress || typeof o.progress !== 'object') return { snapshot: null, corrupt: true, legacy: false };
    // Снимок из более новой версии игры: поля, которых эта версия не знает, переносим как есть,
    // иначе следующая запись отсюда стёрла бы их и в облаке.
    const progress = o.v > SCHEMA_VERSION ? keepUnknown(o.progress as Record<string, unknown>, normalizeProgress(o.progress)) : normalizeProgress(o.progress);
    return {
      snapshot: { v: SCHEMA_VERSION, rev: nonNegInt(o.rev) ?? legacyRevision(progress), at: nonNegInt(o.at) ?? 0, progress },
      corrupt: false,
      legacy: false,
    };
  }
  if (LEGACY_FIELDS.some((k) => k in o)) {
    const progress = normalizeProgress(o);
    return { snapshot: { v: SCHEMA_VERSION, rev: legacyRevision(progress), at: 0, progress }, corrupt: false, legacy: true };
  }
  return { snapshot: null, corrupt: true, legacy: false };
}

/**
 * Какой снимок новее — целиком, без слияния. Больше ревизия — новее; при равной — позже время;
 * при полном равенстве — локальный (ничего не качаем). Нет обоих — null.
 */
export function chooseSnapshot(local: SaveSnapshot | null, cloud: SaveSnapshot | null): 'local' | 'cloud' | null {
  if (!local && !cloud) return null;
  if (!cloud) return 'local';
  if (!local) return 'cloud';
  if (local.rev !== cloud.rev) return local.rev > cloud.rev ? 'local' : 'cloud';
  return cloud.at > local.at ? 'cloud' : 'local';
}

const sameSnapshot = (a: SaveSnapshot, b: SaveSnapshot) => a.rev === b.rev && a.at === b.at;

// ---------------- хранилища ----------------

export function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** window.localStorage, если он есть и доступен на чтение (в песочнице iframe обращение бросает). */
export function browserStorage(): KeyValueStorage | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    ls.getItem(SAVE_KEY);
    return ls;
  } catch {
    return null;
  }
}

function readItem(s: KeyValueStorage, key: string): string | null {
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

// ---------------- хранилище прогресса ----------------

/** Обычное изменение: облако получит его в пачке с соседними. */
const DEBOUNCE_MS = 2000;
/** Важное (покупка, итоги матча, подарок): почти сразу и с flush. */
const CRITICAL_MS = 300;
/** Не чаще одной записи в облако за столько: лимит SDK — 100 запросов за 5 минут. */
const MIN_INTERVAL_MS = 5000;
const SEND_TIMEOUT_MS = 10000;
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60000;
/** Облако не ответило при подключении — пробуем ещё столько раз. */
const ATTACH_RETRIES = 5;
const ATTACH_RETRY_MS = 30000;
/** Перечитывать облако при возврате в игру не чаще раза в минуту. */
const REFRESH_MIN_MS = 60000;

export type AttachResult = 'local' | 'cloud' | 'none';

export interface StoreOptions {
  log?: Log;
  now?: () => number;
  /** Прогресс заменён облачным после старта (поздний ответ облака, вход в аккаунт) — перерисовать меню. */
  onReplaced?: () => void;
}

export interface UpdateOptions {
  /** Важное событие: в облако почти сразу и с flush=true. */
  critical?: boolean;
}

/**
 * Прогресс в памяти + запись. Меняют его только update/commit: каждое изменение поднимает ревизию,
 * сразу пишется локально (не ждёт сеть) и помечает облако «грязным»; облако получает последний
 * снимок пачкой, с паузой между записями. Сбой облака не откатывает локальное и ребёнку не показывается.
 */
export class ProgressStore {
  /** Один объект на всю игру: при замене облачным меняется содержимое, а не ссылка. */
  readonly progress: Progress;
  private rev: number;
  private at: number;
  /** Сохранение уже существует (иначе это нетронутый новый профиль — его в облако не шлём). */
  private persisted: boolean;
  /** При запуске сохранения не было: новое устройство или браузер. */
  private readonly freshAtBoot: boolean;
  private cloud: CloudSave | null = null;
  /** Идущее подключение облака — второе не запускаем, ждём это. */
  private attaching: Promise<AttachResult> | null = null;
  private attachRetry: ReturnType<typeof setTimeout> | null = null;
  private lastRefreshAt = -Infinity;
  private dirty = false;
  private wantFlush = false;
  /** Последняя успешная запись ушла без flush — лежит в очереди SDK и может не дойти до сервера. */
  private queuedInSdk = false;
  /** Попросили дослать немедленно (уход со страницы), пока шла отправка. */
  private flushAfterSend = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerDue = 0;
  private sending = false;
  private lastSentAt = -Infinity;
  /** После сбоя облака раньше этого времени не пробуем, даже если прогресс снова изменился. */
  private retryNotBefore = -Infinity;
  private failures = 0;
  private readonly log: Log;
  private readonly now: () => number;
  private readonly onReplacedCb?: () => void;

  constructor(
    snapshot: SaveSnapshot | null,
    private readonly local: KeyValueStorage,
    opts: StoreOptions = {},
  ) {
    this.log = opts.log ?? devLog;
    this.now = opts.now ?? Date.now;
    this.onReplacedCb = opts.onReplaced;
    this.progress = snapshot ? snapshot.progress : emptyProgress();
    this.rev = snapshot?.rev ?? 0;
    this.at = snapshot?.at ?? 0;
    this.persisted = !!snapshot;
    this.freshAtBoot = !snapshot;
  }

  get revision(): number {
    return this.rev;
  }

  /** Облако подключено (игрок вошёл и облачный снимок прочитан). */
  get cloudAttached(): boolean {
    return this.cloud !== null;
  }

  /** Есть изменения, которые ещё не дошли до облака. */
  get cloudDirty(): boolean {
    return this.dirty;
  }

  /** Копия текущего снимка — именно она уходит в хранилища (дальнейшие изменения её не трогают). */
  snapshot(): SaveSnapshot {
    return { v: SCHEMA_VERSION, rev: this.rev, at: this.at, progress: JSON.parse(JSON.stringify(this.progress)) as Progress };
  }

  /** Изменить прогресс и сохранить: `store.update((p) => (p.meta.coins += 50))`. */
  update(mutate: (p: Progress) => void, opts: UpdateOptions = {}): void {
    mutate(this.progress);
    this.commit(opts);
  }

  /** Прогресс уже изменён на месте (чистыми функциями meta/*) — сохранить. */
  commit(opts: UpdateOptions = {}): void {
    this.rev++;
    this.at = Math.max(this.now(), this.at + 1);
    this.persisted = true;
    this.writeLocal();
    this.markCloudDirty(!!opts.critical);
  }

  /** Записать текущий снимок локально без новой ревизии (после миграции или загрузки из облака). */
  writeLocal(): boolean {
    try {
      this.local.setItem(SAVE_KEY, JSON.stringify(this.snapshot()));
      return true;
    } catch (e) {
      this.log(`[Save] local save failed: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Подключить облако: прочитать облачный снимок и выбрать новее целиком.
   * Облако новее — прогресс заменяется им и пишется локально; локальный новее — уходит в облако.
   * До успешного чтения облако не подключено, и в него ничего не пишется: иначе старое устройство
   * могло бы перетереть свежий облачный прогресс. Сбой чтения — повтор позже (бросает дальше).
   * Уже подключено — ничего не делает; идёт подключение — ждёт его.
   *
   * preferCloudIfFresh — подключение при запуске: если на этом устройстве сохранения не было,
   * облако выигрывает даже у того, что успели сделать, пока оно медленно отвечало (иначе пара
   * подсказок в обучении на новом устройстве перетёрла бы настоящую игру).
   */
  attachCloud(cloud: CloudSave, opts: { preferCloudIfFresh?: boolean } = {}): Promise<AttachResult> {
    if (this.cloud) return Promise.resolve('none');
    this.attaching ??= this.tryAttach(cloud, !!opts.preferCloudIfFresh, ATTACH_RETRIES).finally(() => (this.attaching = null));
    return this.attaching;
  }

  private async tryAttach(cloud: CloudSave, preferCloudIfFresh: boolean, retriesLeft: number): Promise<AttachResult> {
    let raw: unknown;
    try {
      raw = await cloud.load();
    } catch (e) {
      this.log(`[Save] cloud load failed: ${(e as Error).message}`);
      if (retriesLeft > 0 && !this.attachRetry) {
        this.attachRetry = setTimeout(() => {
          this.attachRetry = null;
          if (this.cloud || this.attaching) return;
          // Повтор — через полминуты и позже: к этому времени на устройстве уже настоящая игра, выбираем по ревизии.
          this.attaching = this.tryAttach(cloud, false, retriesLeft - 1).finally(() => (this.attaching = null));
          this.attaching.catch(() => {});
        }, ATTACH_RETRY_MS);
      }
      throw e;
    }
    if (this.attachRetry) clearTimeout(this.attachRetry);
    this.attachRetry = null;
    this.cloud = cloud;
    this.lastRefreshAt = this.now();
    const parsed = parseSnapshot(raw);
    if (parsed.corrupt) this.log('[Save] cloud save is corrupt — ignoring it');
    if (parsed.snapshot) this.log(`[Save] cloud revision ${parsed.snapshot.rev} loaded`);
    const mine = this.persisted ? this.snapshot() : null;
    const pick = preferCloudIfFresh && this.freshAtBoot && parsed.snapshot ? 'cloud' : chooseSnapshot(mine, parsed.snapshot);
    if (pick === 'cloud') {
      this.takeCloud(parsed.snapshot!, mine);
      return 'cloud';
    }
    if (pick === 'local') {
      this.log(`[Save] selected local revision ${this.rev}`);
      if (!parsed.snapshot || !sameSnapshot(mine!, parsed.snapshot)) this.markCloudDirty(true);
      return 'local';
    }
    return 'none';
  }

  /**
   * Перечитать облако (игра снова на экране): пока вкладка была открыта, другое устройство
   * могло записать новее. Не чаще раза в минуту (лимит getData). Облако новее — берём его.
   */
  async refreshCloud(): Promise<void> {
    const cloud = this.cloud;
    if (!cloud || this.sending || this.dirty || this.now() - this.lastRefreshAt < REFRESH_MIN_MS) return;
    this.lastRefreshAt = this.now();
    const revBefore = this.rev;
    let parsed: ParsedSave;
    try {
      parsed = parseSnapshot(await cloud.load());
    } catch {
      return;
    }
    // Пока читали, игрок успел что-то сделать — своё не затираем, выберем при следующем возврате.
    if (!parsed.snapshot || this.sending || this.dirty || this.rev !== revBefore) return;
    const mine = this.snapshot();
    if (chooseSnapshot(mine, parsed.snapshot) === 'cloud' && !sameSnapshot(mine, parsed.snapshot)) this.takeCloud(parsed.snapshot, mine);
  }

  /**
   * Отправить в облако сейчас (уход со страницы), без паузы между записями — это редкость.
   * Запись без flush только в очереди SDK — дожимаем её с flush. Идёт отправка — дошлём сразу после неё.
   */
  flushCloud(): void {
    if (!this.cloud) return;
    // Идёт отправка — решим после неё: она могла уйти без flush или прогресс успеет измениться.
    if (this.sending) {
      this.flushAfterSend = true;
      return;
    }
    if (!this.dirty && !this.queuedInSdk) return;
    this.dirty = true;
    this.wantFlush = true;
    this.clearTimer();
    void this.send();
  }

  private takeCloud(s: SaveSnapshot, mine: SaveSnapshot | null): void {
    if (mine) {
      try {
        this.local.setItem(REPLACED_KEY, JSON.stringify(mine));
      } catch {
        // не страшно: это только запасная копия
      }
    }
    this.replace(s);
    this.writeLocal();
    this.log(`[Save] selected cloud revision ${this.rev}`);
    this.onReplacedCb?.();
  }

  private replace(s: SaveSnapshot): void {
    const target = this.progress as unknown as Record<string, unknown>;
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, JSON.parse(JSON.stringify(s.progress)));
    this.rev = s.rev;
    this.at = s.at;
    this.persisted = true;
    // Идёт отправка старого снимка — после неё облако надо выровнять по выбранному.
    if (this.sending) this.dirty = true;
  }

  private markCloudDirty(critical: boolean): void {
    if (!this.cloud) return;
    this.dirty = true;
    if (critical) this.wantFlush = true;
    this.arm(critical ? CRITICAL_MS : DEBOUNCE_MS);
  }

  /** Поставить отправку: не раньше паузы после прошлой записи и повтора после сбоя; уже стоящую раньше — не откладываем. */
  private arm(delay: number): void {
    if (this.sending) return; // после ответа отправим последний снимок сами
    const due = Math.max(this.now() + delay, this.lastSentAt + MIN_INTERVAL_MS, this.retryNotBefore);
    if (this.timer && this.timerDue <= due) return;
    this.clearTimer();
    this.timerDue = due;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.send();
    }, due - this.now());
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async send(): Promise<void> {
    const cloud = this.cloud;
    if (!cloud || !this.dirty) return;
    const snap = this.snapshot();
    const flush = this.wantFlush;
    this.dirty = false;
    this.wantFlush = false;
    this.sending = true;
    this.lastSentAt = this.now();
    let failed = false;
    try {
      await withTimeout(cloud.save(snap, flush), SEND_TIMEOUT_MS, 'setData');
      this.failures = 0;
      this.retryNotBefore = -Infinity;
      this.queuedInSdk = !flush;
      this.log(`[Save] cloud synced revision ${snap.rev}${flush ? ' (flush)' : ''}`);
    } catch (e) {
      // Локальное уже сохранено — не откатываем; облако догонит при следующей попытке.
      failed = true;
      this.dirty = true;
      this.wantFlush ||= flush;
      this.failures++;
      const retryIn = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (this.failures - 1));
      this.retryNotBefore = this.now() + retryIn;
      this.log(`[Save] Cloud save failed (${(e as Error).message}); retry in ${retryIn} ms`);
    } finally {
      this.sending = false;
    }
    const again = this.flushAfterSend && !failed;
    this.flushAfterSend = false;
    if (again) return this.flushCloud();
    if (this.dirty) this.arm(this.wantFlush ? CRITICAL_MS : DEBOUNCE_MS);
  }
}

/** Облако Яндекса поверх Player Data: один ключ — один снимок. */
export function yandexCloud(player: YaPlayer): CloudSave {
  return {
    load: () => player.getData([CLOUD_KEY]).then((d) => d?.[CLOUD_KEY]),
    save: (snapshot, flush) => player.setData({ [CLOUD_KEY]: snapshot }, flush),
  };
}

// ---------------- запуск ----------------

export interface BootDeps {
  /** SDK Яндекса или null (нет, не загрузился). */
  sdk: () => Promise<YaSdk | null>;
  /** Обычный localStorage (или null — недоступен). */
  browser?: () => KeyValueStorage | null;
  log?: Log;
  onReplaced?: () => void;
  timeouts?: { storage?: number; player?: number; cloud?: number };
}

export type Backend = 'Yandex safeStorage' | 'localStorage' | 'memory';

export interface BootResult {
  store: ProgressStore;
  sdk: YaSdk | null;
  backend: Backend;
  authorized: boolean;
}

/**
 * Загрузка прогресса до первого экрана: SDK → safeStorage → локальный снимок → игрок →
 * облако (если вошёл) → выбор снимка → миграция. Ни один шаг не вешает запуск: у каждого
 * потолок по времени, а при сбое игра идёт на локальном сохранении. Никаких окон входа.
 */
export async function bootSave(deps: BootDeps): Promise<BootResult> {
  const log = deps.log ?? devLog;
  const t = { storage: 2500, player: 2500, cloud: 4000, ...deps.timeouts };
  const browser = deps.browser ?? browserStorage;
  const sdk = await deps.sdk().catch(() => null);

  // 1. Где храним локально: safeStorage Яндекса → localStorage → память.
  let backend: Backend = 'memory';
  let local: KeyValueStorage | null = null;
  if (sdk) {
    try {
      local = await withTimeout(sdk.getStorage(), t.storage, 'getStorage');
      backend = 'Yandex safeStorage';
    } catch (e) {
      log(`[Save] safeStorage unavailable: ${(e as Error).message}`);
    }
  }
  const plain = browser();
  if (!local && plain) {
    local = plain;
    backend = 'localStorage';
  }
  local ??= memoryStorage();
  log(`[Save] storage backend: ${backend}`);

  // 2. Локальный снимок. Старые версии писали в обычный localStorage — читаем и его.
  const rawPrimary = readItem(local, SAVE_KEY);
  const primary = parseSnapshot(rawPrimary);
  const secondary = plain && plain !== local ? parseSnapshot(readItem(plain, SAVE_KEY)) : null;
  const useSecondary = !!secondary?.snapshot && chooseSnapshot(primary.snapshot, secondary.snapshot) === 'cloud';
  const chosen = useSecondary ? secondary! : primary;
  if (primary.corrupt && rawPrimary) {
    try {
      local.setItem(CORRUPT_KEY, rawPrimary);
    } catch {
      // нет места — не страшно
    }
  }
  if (primary.corrupt && !chosen.snapshot && import.meta.env.DEV) console.warn('[Save] local save is corrupt — starting a new profile');
  if (chosen.snapshot) log(`[Save] local revision ${chosen.snapshot.rev} loaded${chosen.legacy ? ' (migrated from old save)' : ''}`);

  // Звук раньше жил под своим ключом — переносим в настройки снимка.
  const muteRaw = readItem(plain ?? local, LEGACY_MUTE_KEY);
  const legacyMute = muteRaw !== null && (!chosen.snapshot || chosen.legacy);

  const store = new ProgressStore(chosen.snapshot, local, { log, onReplaced: deps.onReplaced });
  if (legacyMute) store.progress.settings.muted = muteRaw === '1';
  // Миграция и перенос из старого места — сразу записать в текущей схеме (ревизия та же).
  if (chosen.snapshot && (chosen.legacy || useSecondary)) {
    if (store.writeLocal() && legacyMute) {
      try {
        (plain ?? local).removeItem(LEGACY_MUTE_KEY);
      } catch {
        // останется старый ключ — его больше никто не читает после миграции
      }
    }
  }

  // 3. Игрок и облако. Только если уже вошёл: окно входа само не открываем никогда.
  let authorized = false;
  if (sdk) {
    try {
      const player = await withTimeout(sdk.getPlayer(), t.player, 'getPlayer');
      authorized = player.isAuthorized();
      log(`[Save] player authorized: ${authorized}`);
      if (authorized) await withTimeout(store.attachCloud(yandexCloud(player), { preferCloudIfFresh: true }), t.cloud, 'cloud load');
    } catch (e) {
      // Облако подключится позже (повтор в attachCloud), а пока — локальный прогресс.
      log(`[Save] cloud unavailable at start: ${(e as Error).message}`);
    }
  }
  return { store, sdk, backend, authorized };
}

/**
 * Вход в Яндекс по нажатию игрока («Сохранить прогресс в облаке») и перенос гостевого прогресса.
 * После окна входа игрок берётся заново — старый объект мог остаться неавторизованным.
 * Выбор снимка — как при запуске: новее целиком; гостевой прогресс не теряется, если он новее облака.
 */
export async function signInAndSync(sdk: YaSdk, store: ProgressStore): Promise<AttachResult | 'cancelled' | 'failed'> {
  try {
    await sdk.auth.openAuthDialog();
  } catch {
    return 'cancelled';
  }
  try {
    const player = await withTimeout(sdk.getPlayer(), 5000, 'getPlayer');
    if (!player.isAuthorized()) return 'cancelled';
    // Облако не ответило — подключится повтором само; гостевой прогресс остаётся локально.
    return await store.attachCloud(yandexCloud(player));
  } catch {
    return 'failed';
  }
}
