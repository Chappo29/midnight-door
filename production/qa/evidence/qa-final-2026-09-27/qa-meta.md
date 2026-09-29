# QA-аудит: мета-прогрессия, сохранения, платформа (Midnight Door)

Дата: 2026-09-27. Код проверялся как есть, вместе с незакоммиченной работой по Yandex SDK.
Репро-тесты лежат в `tests/qa-scratch/meta/` (запуск: `npx vitest run tests/qa-scratch/meta`). Результат: **3 файла, 19 тестов, все зелёные**.
Каждый тест проверяет **текущее (ошибочное)** поведение, поэтому зелёный прогон значит, что баг воспроизвёлся.

- `meta_pure.test.ts`: экономика, `ProgressStore` и `parseSnapshot`, реклама в `YandexPlatform`.
- `main_flow.test.ts`: гоняет **настоящий** `src/main.ts` (boot → меню → start → onEnd → onReplaced → облако) с заглушками вместо Phaser, Hud, GameScene, звука и спрайтов и с поддельным SDK Яндекса.
- `sdk_late.test.ts`: медленный `YaGames.init` и медленный `getPlayer` при запуске.

---

## META-1 | Class: BUG | Severity: Major | Confidence: confirmed
**Двойной запуск матча, пока ждём межстраничную рекламу (двойной тап по сложности, «Ещё раз», «Попробовать!»; «Меню» не отменяет старт)**

Repro steps
1. Сыгран хотя бы один матч (`matches ≥ 1`), SDK Яндекса подключён.
2. В меню тапнуть «Лёгкая», затем, пока не появилась реклама, тапнуть «Кошмар» (или дважды одну кнопку).
3. Вариант: на итогах «Ещё раз», а следом «Меню».
4. Вариант: дважды «Попробовать!» на экране «Новое!».

Expected / Actual
- Ожидается один матч той сложности, которую игрок выбрал, а «Меню» отменяет старт.
- На деле первый вызов `start()` ждёт `showInterstitial()`, а экран остаётся на месте и принимает нажатия: `hideScreen` идёт только после рекламы, поэтому защита от эха не срабатывает. Второй `start()` получает `adBusy`, реклама для него сразу возвращает `false`, и он **сразу** запускает матч №2 под рекламой. Этот матч заморожен паузой `'ad'`. Когда реклама закрывается, первый `start()` перезапускает сцену с матчем №1.
- В итоге игрок попадает на сложность **первого** тапа, а `lastDifficulty` запоминает второй.
- «Меню» после «Ещё раз» показывает меню, но после рекламы матч всё равно стартует.
- Двойное «Попробовать!» делает два `commit` (rev +2) и два старта.

Why it matters
Гонка есть перед каждым матчем, начиная со второго: и «Ещё раз», и «Попробовать!» всегда идут через рекламу. Дети часто тапают дважды. Скрытый матч №2 успевает создать сцену, и на его старте HintDirector может «съесть» подсказку. Если SDK вообще не ответит (META-8), игрок 90 с сидит в замороженном матче без звука. В DEV и с `?fakeads` бага не видно: `domFakeAds` закрывает экран синхронно, а настоящий SDK рисует рекламу с задержкой.

Root cause: `src/main.ts:start:300-301`: `await platform.showInterstitial()` стоит до `hud.hideScreen()`, повторного входа ничто не защищает, `showMenu` не отменяет ожидающий старт. Ещё `src/platform/platform.ts:runAd:117`: при `adBusy` реклама сразу возвращает `false`.

Evidence (`main_flow.test.ts`):
```
✓ double tap on a difficulty while the pre-match interstitial is pending -> two matches started, final one is the FIRST tap
    adCalls = ['fs']; starts[0].opts.difficulty = 'nightmare' (under the ad); after onClose starts[1] = 'easy'
✓ result screen: "Ещё раз" then "Меню" while the interstitial is pending -> menu shown, then a match starts anyway
✓ double tap "Попробовать!" on the unlock preview (from menu) -> preview committed twice and two starts   (rev +2)
```

Suggested fix: завести токен запуска. `let launch = 0;` В начале `start()` и `startTutorial()` делать `const my = ++launch`, после каждого `await` выходить, если `my !== launch`. `showMenu()` тоже делает `++launch`. Кроме того, `hud.hideScreen()` (или хотя бы блокировку ввода) перенести **до** `await platform.showInterstitial()`.

---

## META-2 | Class: BUG | Severity: Major | Confidence: confirmed
**Позднее облако перерисовывает меню поверх уже идущего обучения или матча (первый запуск на новом устройстве, медленная сеть)**

Repro steps
1. Игрок вошёл в Яндекс, на устройстве сохранения нет, сеть медленная: `getData` > 4 с, спрайты ещё грузятся.
2. `boot` перестаёт ждать облако через 4 с и вызывает `startTutorial()`. Та прячет экран и ждёт `whenLoaded()`.
3. Приходит облако с `tutorial: 'done'`. Срабатывает `onReplaced`: сцена ещё не активна, поэтому вызывается `showMenu()`.
4. Спрайты догружаются, `startTutorial()` продолжается и запускает сцену обучения.
5. То же у вернувшегося игрока, который нажал сложность до конца загрузки спрайтов.

Expected / Actual
- Ожидается: либо меню (облако говорит «обучение пройдено»), либо обучение без меню поверх.
- На деле карточка меню висит **поверх живой сцены** обучения или матча: симуляция идёт, HUD `in-game`. Облачный прогресс говорит, что обучение пройдено, а оно всё равно запущено.

Why it matters
Игрок видит неконсистентный экран: меню, а под ним тикает матч. Правило Яндекса 1.14 требует, чтобы не было «ошибок и тупиков». Сценарий как раз тот, ради которого придуман `preferCloudIfFresh`: новое устройство и медленное облако.

Root cause: `src/main.ts:boot/onReplaced:488` проверяет только `game.scene.isActive('game')` и не знает про ожидающие `startTutorial()`/`start()`. Эти функции после `await whenLoaded()` не проверяют, актуальны ли они ещё (`main.ts:257`, `main.ts:302`).

Evidence (`main_flow.test.ts`):
```
✓ first launch on a new device, cloud answers after the 4 s boot timeout while sprites still load -> menu drawn OVER the running tutorial
    hud.screen = showStart; scene.starts[0].match.opts.tutorial = true; scene active
✓ returning player taps a difficulty before sprites load, late cloud arrives -> menu drawn over the running match
```

Suggested fix: тот же токен, что в META-1. `showMenu()` отменяет ожидающий запуск, `startTutorial()` и `start()` после `await whenLoaded()` проверяют токен и выходят.

---

## META-3 | Class: BUG | Severity: Major | Confidence: confirmed
**`preferCloudIfFresh` не ограничен по времени: ответ облака через минуты стирает весь прогресс, набранный на новом устройстве**

Repro steps
1. Новое устройство, игрок вошёл в Яндекс, `getData` отвечает медленно (без ошибки).
2. Игрок проходит обучение, играет матчи, покупает. Ревизия растёт до 30+.
3. Через 5 минут приходит облачный снимок rev 2.

Expected / Actual
- В SAVE_SYSTEM.md сказано, что приоритет облака «действует только для первой попытки при запуске… к этому времени на устройстве уже может быть настоящая игра». Значит, ожидается выбор по ревизии.
- На деле первая попытка не ограничена по времени и всегда берёт облако. Монеты (300 → 5), матчи (3 → 0) и покупки откатываются, rev падает с 31 до 2. Копия остаётся только в `…-replaced`.

Why it matters
Потерянный прогресс, в том числе потраченные монеты и открытые постройки. Если замена случилась посреди матча, награда за матч ляжет уже на облачный профиль.

Root cause: `src/platform/save.ts:tryAttach:323` (`await cloud.load()` без таймаута) и `:345` (`preferCloudIfFresh && this.freshAtBoot` без учёта времени и того, что уже сыграно).

Evidence (`meta_pure.test.ts`):
```
✓ preferCloudIfFresh has no time bound: a cloud answer after 5 minutes wipes all progress made on this device
    attach -> 'cloud'; coins 5 (was 300); matches 0 (was 3); revision 2
```

Suggested fix: в `tryAttach` обернуть загрузку: `raw = await withTimeout(cloud.load(), 10_000, 'getData')`. Поздний ответ тогда станет сбоем и уйдёт в повтор, который выбирает по ревизии. Дополнительно можно применять `preferCloudIfFresh` только при `this.progress.matches === 0`.

---

## META-4 | Class: BUG | Severity: Major | Confidence: confirmed
**Зависший `getData` (без ответа и без ошибки) навсегда отключает облако на эту сессию: повтора нет, «Сохранить» висит без ответа**

Repro steps: `player.getData` возвращает промис, который никогда не завершается.

Expected / Actual
- По SAVE_SYSTEM.md, таблица «Сбои»: «`getData()` упал **или завис** — облако подключится повтором».
- На деле повтор ставится только в `catch`. Висящий промис держит `attaching` навсегда: за 10 минут `load` вызван ровно 1 раз, `cloudAttached = false`. Последующий `signInAndSync` получает тот же висящий промис и не завершается: ни тоста, ни ошибки, а `getData` нового игрока не вызывается ни разу.

Why it matters
Вошедший игрок играет всю сессию без облака, и об этом никто не узнаёт. Второе устройство потом получит старый снимок.

Root cause: `src/platform/save.ts:tryAttach:323` ждёт без таймаута. `attachCloud:316` (`this.attaching ??=`) переиспользует повисший промис.

Evidence (`meta_pure.test.ts`):
```
✓ hung getData (never settles) => cloud never attaches, no retry, signInAndSync never resolves
    loads = 1 after 10 min; cloudAttached false; signIn settled = false; new player.getData not called
```

Suggested fix: то же, что в META-3: `withTimeout(cloud.load(), …)` внутри `tryAttach`. Тогда сработают существующий `catch` и повтор.

---

## META-5 | Class: BUG | Severity: Major | Confidence: confirmed
**SDK, который инициализировался дольше 4 с, выбрасывается: нет Game Ready, событий паузы, рекламы и облака на всю сессию**

Repro steps: медленная сеть, `YaGames.init()` отвечает через 6 с.

Expected / Actual
- Ожидается, что SDK подключится, как только ответит: хотя бы `LoadingAPI.ready()`, `game_api_pause/resume` и реклама.
- На деле `initYandexSdk` возвращает `null` по таймауту 4 с, и дальше вызывается `platform.attach(null)`. Живой SDK через 6 с никто не подхватывает. Кроме того, `platform.ready()` при `sdk = null` всё равно ставит `readySent = true` (`platform.ts:66-69`), так что Game Ready не уйдёт, даже если SDK подключить позже.

Why it matters
Правило 1.19.2 (Game Ready обязателен) и 4.7 (пауза на рекламе платформы): на медленной сети модерация увидит, что Game Ready не пришёл. Для таких игроков нет монетизации и облака.

Root cause: `src/platform/yandex.ts:initYandexSdk:86-99` (результат после таймаута теряется); `src/main.ts:boot:478-481`; `src/platform/platform.ts:ready:66`.

Evidence (`sdk_late.test.ts`):
```
✓ YaGames.init answering after 4 s -> initYandexSdk returns null and the live SDK is dropped
    got = null at 4 s; inited = true at 7 s; got still null
```

Suggested fix:
1. В `initYandexSdk` сохранить промис `init()` и отдавать его как `lateSdk`.
2. В `main.ts` после `boot`: `lateSdk.then(s => { if (s && !saved.sdk) { platform.attach(s); platform.ready(); } })`.
3. В `ready()` ставить `readySent = true` только если `this.sdk?.features?.LoadingAPI` существует.

---

## META-6 | Class: BUG | Severity: Minor | Confidence: confirmed
**Медленный `getPlayer` (> 2,5 с) при запуске: вошедший игрок до конца сессии считается гостем, облако не подключается никогда**

Expected / Actual
- В комментарии `save.ts:583` написано: «Облако подключится позже (повтор в attachCloud)».
- На деле при таймауте `getPlayer` функция `attachCloud` не вызывается вообще. `authorized = false`, `getPlayer` за 10 минут вызван 1 раз, `setData` ни разу. В меню вошедшему игроку показывается кнопка «Сохранить».

Why it matters: прогресс всей сессии не попадает в облако, и игрок на другом устройстве откатится. Путаница с кнопкой входа.

Root cause: `src/platform/save.ts:bootSave:576-585`.

Evidence (`sdk_late.test.ts`):
```
✓ getPlayer slower than 2.5 s at boot -> authorized player treated as guest for the whole session; cloud never attached
```

Suggested fix: при таймауте не бросать промис `getPlayer`, а дождаться его: `pending.then(p => p.isAuthorized() && store.attachCloud(yandexCloud(p)).catch(() => {}))`.

---

## META-7 | Class: BUG | Severity: Minor | Confidence: confirmed
**Реклама за награду: таймаут 90 с срабатывает, пока ролик ещё на экране. Пауза снимается, досмотренная награда теряется**

Repro steps: ролик за награду (×2 монеты или «Вернуться в комнату») идёт дольше 90 с (длинный ролик, пауза в ролике, долгая концевая карточка), потом `onRewarded` и `onClose`.

Expected / Actual
- Ожидается, что награда выдаётся по `onRewarded`, а игра остаётся на паузе до `onClose`.
- На деле на 90-й секунде `finish()` снимает паузу `'ad'`, и звук и игра идут под рекламой. Промис возвращает `false`, поздний `onRewarded` игнорируется.

Why it matters: правило 4.7 (звук под рекламой) и честность награды: ребёнок досмотрел ролик и ничего не получил.

Root cause: `src/platform/platform.ts:runAd:131`: таймер ставится от старта вызова, а не от `onOpen`.

Evidence (`meta_pure.test.ts`):
```
✓ rewarded: 90 s timeout fires while the ad is still open -> pause lifted under the ad, later onRewarded is lost
    result=false; paused=false at 90 s; pauses=[true,false]
```

Suggested fix: короткий таймаут только на ожидание `onOpen` (например, 10 с). После `onOpen` не резолвить по таймеру, либо увеличить потолок до 5 минут.

---

## META-8 | Class: BUG | Severity: Minor | Confidence: confirmed (механика), likely (частота)
**SDK не вызвал ни одного колбэка межстраничной рекламы: 90 с мягкой блокировки перед матчем, а меню при этом активно**

Repro steps: `showFullscreenAdv` ничего не вызывает (блокировщик, сбой SDK), и игрок тапает сложность.

Expected / Actual
- Ожидается, что матч стартует через несколько секунд.
- На деле `start()` висит 90 с, звук выключен паузой `'ad'`, меню остаётся на экране и принимает нажатия. Любой следующий тап запускает матч, который тут же замораживается той же паузой (см. META-1). Через 90 с сцена перезапускается.

Root cause: `src/platform/platform.ts:runAd:131` (`AD_TIMEOUT_MS = 90_000` на всё сразу) вместе с `main.ts:start:300`.

Evidence (`meta_pure.test.ts`):
```
✓ interstitial whose SDK never calls back blocks start() for 90 s; a second call meanwhile resolves at once (adBusy)
    second=true immediately, paused=true; first resolves only at 90 000 ms
```

Suggested fix: как в META-7: таймаут 5–10 с без `onOpen`, после него продолжать без рекламы. И токен запуска из META-1.

---

## META-9 | Class: BALANCE | Severity: Minor | Confidence: confirmed
**Подарок дня можно забирать бесконечно, переключая дату устройства туда-обратно**

Repro steps: забрать подарок 28.09, перевести часы на 27.09 и забрать снова, вернуть на 28.09 и забрать снова, и так далее.

Expected / Actual
- Ожидается один подарок в сутки.
- На деле условие `last !== today` засчитывает любой другой день, даже прошлый. Шесть переключений дали 280 монет за «два дня», а после `2026-10-10` снова доступно `2026-09-01`.

Why it matters: полностью ломает экономику магазина. На телефоне ребёнка поменять дату несложно.

Root cause: `src/meta/economy.ts:dailyAvailable:246`.

Evidence (`meta_pure.test.ts`):
```
✓ daily gift: toggling device date between two days yields a claim on every toggle (uses !== not >)
```

Suggested fix: `return today > m.daily.last;`. Ключи вида `YYYY-MM-DD` сравниваются как строки корректно. Откат часов назад тогда ничего не даёт.

---

## META-10 | Class: UX | Severity: Minor | Confidence: confirmed
**Кнопка «Сохранить» (вход в облако) остаётся в меню после того, как облако подключилось повтором, а после входа меню перерисовывается дважды**

Repro steps
1. Гость нажимает «Сохранить» и входит. `getData` падает, и игрок видит тост «Не получилось».
2. Через 30 с повтор `attachCloud` подключает облако, срабатывает `onReplaced`, затем `showMenu`.

Expected / Actual
- Ожидается, что кнопки «Сохранить» больше нет.
- На деле `cloudSave` обнуляется только в `.then` у `signInAndSync`, поэтому кнопка остаётся. Её повторное нажатие снова открывает окно входа, хотя игрок уже вошёл.
- При успешном входе `showMenu()` вызывается дважды: из `onReplaced` и из `.then`. Это дважды открывает «Новое!» или «Подарок дня», а событие `track('unlock_preview')` уходит дважды.

Root cause: `src/main.ts:boot:497-504`, `showMenu:176`.

Evidence (`main_flow.test.ts`):
```
✓ "Сохранить" (cloud sign-in) button stays in the menu after the cloud attached via retry
    getData called 2x; after retry showStart meta.onCloud is still a function
```

Suggested fix: в `showMenu` передавать `onCloud: store.cloudAttached ? undefined : cloudSave ?? undefined`. В `.then` у `cloudSave` не вызывать `showMenu()`, если `r === 'cloud'`: его уже вызвал `onReplaced`.

---

## META-11 | Class: UX | Severity: Minor | Confidence: confirmed
**Перечитывание облака при возврате во вкладку выбрасывает игрока из магазина или «Подарка дня» в меню**

Repro steps: открыть магазин, свернуть вкладку больше чем на минуту, пока другое устройство пишет новее, и вернуться.

Expected / Actual
- Ожидается, что магазин остаётся открытым с новыми цифрами.
- На деле `onReplaced` вызывает `showMenu()`, магазин закрывается, и может снова открыться «Подарок дня» или «Новое!».

Root cause: `src/main.ts:boot/onReplaced:488`: при любом неактивном матче вызывается `showMenu()`.

Evidence (`main_flow.test.ts`):
```
✓ cloud refresh on tab return while the shop is open kicks the player to the menu
```

Suggested fix: запоминать текущий экран (`let screen: 'menu'|'shop'|'daily'|'unlock'`) и в `onReplaced` перерисовывать именно его: для магазина `openShop()`, для меню `showMenu()`.

---

## META-12 | Class: BUG / TECH DEBT | Severity: Minor | Confidence: confirmed
**Замыкания держат старые `progress.unlocks` и `progress.meta`: после замены облаком отметка «Новое!» пишется в отцепленный объект**

Repro steps
1. Итоги матча, «Меню», появился экран «Новое!» (сцена ещё активна, поэтому `onReplaced` меню не перерисовывает).
2. Пока экран открыт, облако заменило прогресс (возврат во вкладку).
3. Игрок нажимает «В меню».

Expected / Actual
- Ожидается, что экран «Новое!» отмечен просмотренным и больше не появляется.
- На деле `ProgressStore.replace` сохраняет ссылку на `progress`, но `progress.unlocks` и `progress.meta` становятся **новыми** объектами. `previewButtons` получил старый `progress.unlocks` при открытии экрана, поэтому `markPreviewSeen` пишет в мусор, `commit` сохраняет прогресс без отметки, и тот же экран «Новое!» показывается снова.
- Та же ловушка в `openShop` (`const m = progress.meta`, main.ts:200) и `openDaily` (main.ts:238): покупка или подарок записались бы в отцепленный `meta`. Сейчас это маскирует META-11 (`showMenu` закрывает эти экраны), но любая правка META-11 без исправления этого пункта превратит его в потерю покупок и подарков.

Root cause: `src/main.ts:openUnlock:194`, `openShop:200`, `openDaily:238` вместе с `src/platform/save.ts:replace:411-414` (замена вложенных объектов целиком).

Evidence (`main_flow.test.ts`):
```
✓ cloud replaced while on the result screen: preview "Попробовать!" marks the DETACHED unlocks object -> preview reappears
```

Suggested fix: в обработчиках читать `progress.meta` и `progress.unlocks` в момент нажатия, а не при открытии экрана. Например, в `openShop` вызывать `buyHero(progress.meta, look)`, а в `openUnlock` передавать в `previewButtons` обёртку, которая берёт `progress.unlocks` при нажатии.

---

## META-13 | Class: TECH DEBT | Severity: Minor | Confidence: confirmed
**Прямая совместимость: герой, купленный в новой сборке, стирается старой вкладкой и уходит в облако уже без него**

Repro steps
1. В новой сборке (при той же `v = 2`) добавлен герой 6, игрок купил его на устройстве A.
2. Устройство B с открытой старой вкладкой (кэш) подтягивает облако.
3. `normalizeMeta` выкидывает героя 6 и выбирает героя 0.
4. Первое же изменение на B отправляет в облако снимок с большей ревизией и без героя.

Expected / Actual
- Ожидается, что неизвестные покупки сохраняются, как это уже сделано для скинов и для `v > 2`.
- На деле `heroes: [0, 6]` превращается в `[0]`, а `hero` в 0. Монеты, потраченные на героя, потеряны.

Root cause: `src/meta/economy.ts:normalizeMeta:56`: фильтр по текущему `HEROES`. `keepUnknown` работает только при `v > SCHEMA_VERSION` и массивы всё равно заменяет.

Evidence (`meta_pure.test.ts`):
```
✓ forward-compat: hero bought in a newer build (look 6) is silently dropped by normalizeMeta
```

Suggested fix: в `heroes` оставлять любые целые ≥ 0, а `hero` выбирать только среди известных, как у скинов. Альтернатива: при каждом добавлении героев поднимать `SCHEMA_VERSION`.

---

## META-14 | Class: TECH DEBT | Severity: Minor | Confidence: confirmed
**`parseSnapshot` принимает `progress: []` как валидный пустой профиль, а rev больше `MAX_SAFE_INTEGER` замораживает ревизию**

Expected / Actual
- `{"v":2,"rev":900,"progress":[]}` не помечается как `corrupt`: получается пустой профиль с rev 900. Такой снимок не попадает в `CORRUPT_KEY` и побеждает любой локальный снимок с rev < 900.
- `rev: 1e300` принимается, после чего `commit()` ревизию не увеличивает (`1e300 + 1 === 1e300`), и выбор снимка работает только по `at`.

Why it matters: такое возможно только при испорченных или подделанных данных, но система сохранения обещает «починку вместо сброса».

Root cause: `src/platform/save.ts:parseSnapshot:113-119` (`typeof o.progress === 'object'` пропускает массив; `nonNegInt` без проверки `Number.isSafeInteger`).

Evidence (`meta_pure.test.ts`):
```
✓ parseSnapshot accepts {v:2, progress: []} as a valid empty profile (not flagged corrupt)
✓ huge rev (>MAX_SAFE_INTEGER) is accepted and commit no longer increments it
```

Suggested fix: `if (!o.progress || typeof o.progress !== 'object' || Array.isArray(o.progress)) → corrupt`. В `nonNegInt` добавить `Number.isSafeInteger(Math.floor(v))`.

---

## Проверено, багов не найдено

- **Экономика: границы.** Ровно хватает — покупка проходит. Не хватает 1 — «Не хватает монет», монеты не тронуты. 0 монет — отказ. Лимит усилителей 3. Награды (`matchReward`, `exitReward`, командная победа ×0,5 через `Math.round`) всегда целые. Отрицательных цен нет. `safeInt` отбрасывает NaN, минус и дробную часть.
- **×2 монеты.** `adButton` блокирует все кнопки окна на время ролика, повторный показ отсекает `adBusy`, после успеха кнопка удаляется. Монеты начисляются только при `onRewarded`. Уйти с экрана во время ролика нельзя: кнопки неактивны, а `onReplaced` при активной сцене не перерисовывает экран.
- **Подарок дня дважды.** Обработчик висит с `{ once: true }`, плюс защита `dailyAvailable` в `claimDaily`. Экран без «Забрать» не закрывается, поэтому автопоказ не зацикливается.
- **Двойная покупка в магазине.** После покупки магазин перерисовывается, `screenChangedAt` обновляется, и защита от эха (1 с, 60 px) глотает второй тап. Проверки в `buy*` повторную покупку тоже не пропускают.
- **Усилители.** `planBoosters` ничего не списывает, `spendBoosters` вызывается один раз за матч (флаг `boostersSpent`, только при начале ночи). Выход до ночи оставляет покупки. «Ещё раз» заново планирует от текущего `meta`.
- **Подарок за обучение.** Выдаётся один раз для любых путей: done, skipped, выход в меню, повтор из меню. Пропуск после «пройдено» не превращает его в «пропущено».
- **`onEnd` и `onMenu` за один матч.** Карточка поимки ставит `caughtPaused`, и симуляция стоит. `onPlayerCaught` выходит, если исход уже решён. `togglePause` запрещён после `ended` и `result`. Дух → пауза → меню засчитывается как `caughtExit` (по дизайну). Вернувшийся в комнату (`revive` сбрасывает `caught`) при выходе получает `quit`.
- **Открытия построек.** Ровно одно за матч через `recordMatchOutcome`. `quit` счётчик не двигает, `caughtExit` двигает. Ожидающий экран «Новое!» сохраняется с `critical` ещё в `onEnd` и после перезагрузки показывается снова. Экран считается пройденным только по кнопке. Старые сохранения открывают заработанное молча. `justUnlocked` без показанного экрана в матч не попадает: меню всегда сначала показывает «Новое!».
- **`normalizeProgress`.** NaN, минус и строки в `matches`/`wins` дают 0. `hints` строкой даёт `[]`, повторы и нестроки убираются. Неизвестный `tutorial` отбрасывается, `settings.muted` принимается только как `true`. Сохранение новее схемы (`v > 2`) сохраняет неизвестные поля. Битое локальное сохранение копируется в `CORRUPT_KEY`. Переезд из `localStorage` в safeStorage выбирает снимок по ревизии.
- **`ProgressStore`.** Пачка, `flush`, пауза 5 с, повторы с backoff, `flushAfterSend`, `queuedInSdk`. `replace` во время отправки ставит `dirty`. `refreshCloud` не трогает облако при `dirty`/`sending` и сменившейся ревизии. Ссылка на объект `progress` при замене сохраняется (проблема только во вложенных объектах, см. META-12).
- **Платформа.** Причины паузы объединяются через Set, `onPauseChange` зовётся только при смене. `GameplayAPI.start/stop` тоже только при смене и учитывают паузу. `ready()` уходит один раз (но см. META-5 про `readySent` без SDK). `onClose(wasShown=false)` и `onError` продолжают игру.
- **`lastDifficulty` после перезагрузки** равна «Лёгкой», так и задокументировано в SAVE_SYSTEM.md.
