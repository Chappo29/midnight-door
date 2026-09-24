# Промпты для спрайтов

## Как это работает

1. Генерируешь картинку по промпту ниже.
2. Сохраняешь PNG **с прозрачным фоном** под указанным именем в `src/assets/sprites/`.
3. Игра подхватывает файл сама. Каких-то спрайтов нет — вместо них остаётся нынешняя простая графика. Так что подкладывать можно по одному.

Картинки нужны квадратные или близкие к квадрату, 1024×1024 хватит. Уменьшу я их сам.

## Где генерировать

- **ChatGPT (генерация картинок) — удобнее всего.** Он умеет делать прозрачный фон, если попросить: «transparent background, PNG». Все спрайты генерируй **в одном чате**, начиная с «эталона» (шаг 0). Тогда стиль держится одинаковым.
- **Midjourney / Leonardo** тоже подойдут: эталонную картинку передавай как style reference (`--sref <ссылка>` в Midjourney). Прозрачного фона там нет, его потом снимает любой remove-background сервис.

## Правила для всех спрайтов

- Один объект на картинке, целиком, по центру, без обрезки.
- Без текста, букв и цифр.
- Без тени на полу, без фона, без рамки.
- Не страшно: игра для детей 6+. Никакой крови, клыков и жутких лиц.
- **Без радуги**: никаких радужных полос и шестицветных колец. В РФ такое могут принять за «пропаганду», и модерация Яндекса откажет. Самый верхний уровень рисуем золотом и самоцветами. Разноцветная посыпка россыпью допустима, полосы — нет.
- Если вышло не в стиле эталона — перегенерируй. Разнобой стилей портит всё сильнее, чем простой арт.

---

## Шаг 0. Эталон стиля (в игру не идёт)

Сначала сделай эталон, одобри его и только потом генерируй остальное со ссылкой на него.

```
Style reference sheet for a cozy cartoon mobile game about kids defending their dorm rooms from a silly ghost at night.
Show on one sheet: a kid character, a small red sofa, a wooden door, a friendly white ghost, a carved-free orange pumpkin.
Art style: cute chunky cartoon, top-down 3/4 view (camera looking down at about 60 degrees), thick dark purple outlines (#1a1030),
flat cel shading with one soft shadow tone, soft saturated colors, rounded shapes, chibi proportions for characters (big head, small body).
Kid-friendly, not scary. Plain white background, no text.
```

Дальше в начало **каждого** промпта добавляй строку стиля:

```
Game sprite in the same style as the reference: cute chunky cartoon, top-down 3/4 view, thick dark purple outlines (#1a1030),
flat cel shading, soft saturated colors. Single object, centered, fully visible, transparent background, no shadow on the ground, no text.
```

---

## Персонажи (6 шт.)

Ребёнок в полный рост, чиби-пропорции (голова ≈ половина роста), стоит лицом к камере, вид сверху 3/4. Цвет одежды должен совпадать с цветом кружка персонажа в интерфейсе.

**Лучше генерировать всех шестерых одной картинкой.** По одному нейросеть рисует их немного по-разному: толщина контура, размер головы, ракурс. На одной картинке стиль гарантированно общий, а нарезку на `char0`–`char5` сделаю я. Промпт (без строки стиля, она уже внутри):

```
Character lineup sheet for a cozy cartoon mobile game: six kids standing in a row, evenly spaced, same size and pose, facing the camera, top-down 3/4 view.
Cute chunky cartoon style, chibi proportions (big head, small body), thick dark purple outlines (#1a1030), flat cel shading, soft saturated colors. Kid-friendly.
From left to right:
1) brave kid in blue pajamas with a small star print, messy brown hair;
2) girl in coral-red pajamas with two pigtails and a big bow;
3) chubby boy in green pajamas with a hood that has little frog eyes;
4) girl in yellow pajamas with curly orange hair and round glasses;
5) boy in purple pajamas with spiky black hair and a nightcap;
6) small kid in teal pajamas with a bagel-shaped hair bun, holding a teddy bear.
Transparent background, no text, no ground shadows, characters do not overlap.
```

Если какой-то один персонаж не удался, его можно перегенерировать отдельно по таблице ниже, приложив удачную картинку-лайнап как референс.

| Файл | Кто | Промпт (после строки стиля) |
|---|---|---|
| `char0.png` | Ты (игрок) | `A brave kid in blue pajamas with a small star print, messy brown hair, holding nothing, determined smile.` |
| `char1.png` | Мия | `A girl in coral-red pajamas with two pigtails and a big bow, cheerful.` |
| `char2.png` | Тимоха | `A chubby boy in green pajamas with a hood that has little frog eyes, sleepy face.` |
| `char3.png` | Зоя | `A girl in yellow pajamas with curly orange hair and round glasses, curious look.` |
| `char4.png` | Лёва | `A boy in purple pajamas with spiky black hair and a nightcap, nervous smile.` |
| `char5.png` | Бублик | `A small kid in teal pajamas with a bagel-shaped hair bun, holding a teddy bear.` |

## Призрак

| Файл | Промпт |
|---|---|
| `ghost.png` | `A cute mischievous cartoon ghost, white sheet-like body with a wavy bottom edge, small stubby arms raised playfully, big black oval eyes, tiny open mouth, pink blush, faint lavender glow. Funny, not scary.` |

## Дверь (8 уровней + сломанная)

Дверь видна спереди, чуть сверху, форма арочная и квадратная по пропорциям. На каждый уровень своя картинка, так что каждое улучшение заметно.

| Файл | Уровень | Как выглядит |
|---|---|---|
| `door_l1.png` | 1 | простая деревянная из досок, латунная ручка |
| `door_l2.png` | 2 | деревянная с двумя железными полосами |
| `door_l3.png` | 3 | деревянная в железных уголках, большой замок |
| `door_l4.png` | 4 | серая железная с заклёпками и решётчатым окошком |
| `door_l5.png` | 5 | тёмно-синяя стальная с X-образной перекладиной |
| `door_l6.png` | 6 | серебряная бронированная с тремя засовами |
| `door_l7.png` | 7 | золотая с рунами и штурвалом-замком |
| `door_l8.png` | 8 | хрустальная фиолетово-голубая в золотой раме |
| `door_broken.png` | сломана | расщеплённые доски с дырой |

Листы: `docs/art/source/doors_sheet.png` (1, 2, 4, 7, сломанная) и `doors2_sheet.png` (3, 5, 6, 8). Второй сделан с приложенным первым как образцом, поэтому размер и форма совпадают.

## Постройки

| Файл | Промпт |
|---|---|
| `cannon_base.png` | `Round turret base seen strictly from directly above (top-down, not 3/4): a round metal platform with candy-striped red and white rim and bolts. No barrel.` |
| `cannon_barrel.png` | `A short cartoon cannon barrel seen strictly from directly above, lying horizontally and pointing to the RIGHT, candy-striped red and white, wide opening on the right end. Wide image, the barrel fills the width.` |
| `pumpkin.png` | `A friendly round orange pumpkin with a green curly stem and a small cheerful flame burning on top of it, no carved face.` |
| `sofa.png` | `A small cozy red two-seat sofa with a yellow cushion, top-down 3/4 view.` |

Пушка состоит из двух частей: основание стоит на месте, ствол поворачивается в сторону призрака. Поэтому обе части рисуются **строго сверху**, и ствол обязательно смотрит **вправо**.

### Капкан, верстак, холодильник (открываются уровнем двери)

Ключи: `trap`, `trap_l2`, `trap_l3`, `workbench`, `workbench_l2`, `workbench_l3`, `fridge`, `fridge_l2`, `fridge_l3` (ур. 1 — без суффикса). Нет картинки уровня — берётся ближайшая младшая, нет вовсе — рисуется процедурная заглушка (`drawLatePlaceholder` в `src/view/GameScene.ts`). В клетке: капкан — низкая тарелка, верстак — столик, оба примерно в клетку шириной; холодильник стоит, как мебель, основанием у низа клетки. Эти же картинки — иконки в меню постройки.

Листы: `docs/art/source/buildings/trap_sheet.png`, `workbench_sheet.png`, `fridge_sheet.png` (по 3 уровня в ряд).
```
node scripts/slice-sheet.mjs docs/art/source/buildings/trap_sheet.png - trap,trap_l2,trap_l3 --each
node scripts/slice-sheet.mjs docs/art/source/buildings/workbench_sheet.png - workbench,workbench_l2,workbench_l3 --each
node scripts/slice-sheet.mjs docs/art/source/buildings/fridge_sheet.png - fridge,fridge_l2,fridge_l3 --each
```

## Предметы комнаты

| Файл | Промпт |
|---|---|
| `lavender.png` | `A small clay pot with blooming purple lavender flowers, top-down 3/4 view.` |
| `safe.png` | `A small cartoon safe with a round dial, its door slightly open with candies peeking out, top-down 3/4 view.` |
| `toolbox.png` | `A red metal toolbox with a hammer and a wrench sticking out, top-down 3/4 view.` |

## Мебель (препятствия)

| Файл | Промпт |
|---|---|
| `furniture1.png` | `A small wooden wardrobe, top-down 3/4 view.` |
| `furniture2.png` | `A small desk with a glowing desk lamp and a stack of books, top-down 3/4 view.` |
| `furniture3.png` | `A stack of two cardboard boxes with toys peeking out, top-down 3/4 view.` |

---

## С чего начать

Больше всего визуала дают эти пять файлов: `char0`–`char5`, `ghost`, `door_l1`, `sofa`, `cannon_base` + `cannon_barrel`. Остальное можно подкладывать позже.

Скидывай готовые картинки мне в чат или сразу в папку. Я проверю прозрачность и размер, подгоню масштаб под клетку и посмотрю, как они выглядят в игре.

---

## Анимация персонажей (кадры по направлениям)

У каждого персонажа 3 листа (по одному на направление), в каждом 7 поз в ряд:
`idle`, `walk1`–`walk4` (цикл шага), `hammer1` (замах), `hammer2` (удар).

| Лист | Вид | В игре |
|---|---|---|
| `charN_side_sheet.png` | профиль, смотрит **вправо** | идёт или работает вбок; для «влево» картинка зеркалится |
| `charN_up_sheet.png` | спиной к камере | идёт вверх или работает с тем, что выше (дверь нижних комнат) |
| `charN_down_sheet.png` | лицом к камере | идёт вниз или работает с тем, что ниже |

Кроме них остаются `charN_idle.png` (стартовая картинка) и `charN_scared.png` (кадр, когда поймали).

Как делать:
1. В ChatGPT **прикладываешь картинку персонажа** (`docs/art/source/charN.png`). Без неё он путает персонажей.
2. Промпт пишешь одной строкой: переносы строк отправляют сообщение по частям. Пример для вида сбоку:
   ```
   Directional animation sprite sheet for a top-down game. Character: EXACTLY the character from the ATTACHED image (<описание>), same art style, outline thickness and colors. SIDE VIEW (profile), facing and moving to the RIGHT in every pose, camera slightly from above. One single row of 7 poses, left to right, evenly spaced with wide empty gaps, same size, full body, feet on the same baseline: 1) idle standing, facing right; 2) walk cycle frame 1: right leg forward; 3) walk frame 2: legs passing, body slightly up; 4) walk frame 3: left leg forward; 5) walk frame 4: legs passing, body slightly up; 6) small wooden hammer held with both hands raised high above and slightly behind the head; 7) hammer swung down in front to the right at waist height, hitting something. Hammer handle straight. Transparent background, no text, no ground shadows.
   ```
   Для `up` и `down` меняется только описание вида: «BACK VIEW: facing AWAY from the camera…» или «FRONT VIEW: facing the camera…».
3. Нарезка (`--idle=210` делает масштаб по росту в позе покоя, поэтому во всех направлениях герой одного размера):
   ```
   node scripts/slice-sheet.mjs docs/art/source/charN_side_sheet.png charN side_idle,side_walk1,side_walk2,side_walk3,side_walk4,side_hammer1,side_hammer2 --idle=210
   node scripts/contact.mjs charN_side_ проверка.png
   ```

## Гаечный ключ (починка двери)

Дверь чинят ключом, остальное строят молотком. Один лист на персонажа, 7 поз в ряд: поза покоя лицом (по ней масштаб), затем по 2 кадра с ключом: лицом, спиной, сбоку. Промпт — как для молотка, позы: `1) FRONT VIEW idle … 2–3) FRONT VIEW holding a big silver wrench … tilted left / turned right; 4–5) BACK VIEW …; 6–7) SIDE VIEW facing RIGHT …`, плюс `No hammer.` Для Бублика отдельно: `the teddy bear is NOT held in these poses`.
```
node scripts/slice-sheet.mjs docs/art/source/charN_wrench_sheet.png charN wrenchref,down_wrench1,down_wrench2,up_wrench1,up_wrench2,side_wrench1,side_wrench2 --idle=210
```
`charN_wrenchref.png` после нарезки удалить. Если кадров ключа у персонажа нет, он чинит молотком.

Грабли при скачивании: пока картинка генерируется, последним большим изображением на странице оказывается приложенный `charN.png`. Брать только картинки с alt «Сформированное изображение…» и проверять, что лист широкий (~2172×724).

## Пушка по уровням

Уровень 1 — `cannon_base` + `cannon_barrel`. Уровни 2–6 — два листа по 5 штук: `cannon_bases_sheet.png` (основания, приложен `cannon_sheet.png` как образец) и `cannon_barrels_sheet.png` (стволы, приложен лист оснований; шарнир слева, ствол вправо). Темы: 2 красно-белая с заклёпками, 3 мятная, 4 фиолетовая с шипами, 5 золотая с рубинами, 6 бело-золотая с сапфирами и звездой. Радужный 6-й уровень заменён 2026-09-24: `docs/art/source/skins/cannon_*_l6_royal.png`, шарнир 0.16.
```
node scripts/slice-sheet.mjs docs/art/source/cannon_bases_sheet.png - cannon_base_l2,cannon_base_l3,cannon_base_l4,cannon_base_l5,cannon_base_l6 --each
node scripts/slice-sheet.mjs docs/art/source/cannon_barrels_sheet.png - cannon_barrel_l2,cannon_barrel_l3,cannon_barrel_l4,cannon_barrel_l5,cannon_barrel_l6 --each
```
Если детали соседних картинок касаются, `node scripts/keep-largest.mjs <png…>` оставляет только самый большой кусок (результат в `<png>.tmp`). Шарнир у каждого ствола свой — `CANNON_PIVOT` в `src/view/GameScene.ts`.

## Скины двери и пушки (магазин)

Скин — своя серия на **все** уровни, чтобы улучшение оставалось заметным. Надевается только на комнату игрока, у соседей обычные. Файлы:

- дверь: `door_<скин>_l1…l8.png`. Сломанная дверь у всех общая: `door_broken`;
- пушка: `cannon_base_<скин>_l1…l6.png` и `cannon_barrel_<скин>_l1…l6.png`.

Какой-то картинки нет — берётся ближайший младший уровень скина, потом обычная. Скин появляется в магазине, когда в `src/meta/economy.ts` у него стоит `ready: true`.

Листы лежат в `docs/art/source/skins/`. Двери по 4 на лист (`door_<скин>_a` = ур. 1–4, `_b` = ур. 5–8). Образец для `_a` — `doors_sheet.png`, для `_b` — готовый `_a`. Промпт начинается так: `New sprite sheet in EXACTLY the same style as the ATTACHED door sheet: same arched door silhouette… This is a <THEME> skin for the door. One row of 4 doors = upgrade levels 1-4…`, дальше описание каждого уровня: с уровнем дверь всё крепче и наряднее. Темы: пряничная (ginger), ледяная (ice), карамельная (candy).
```
node scripts/slice-sheet.mjs docs/art/source/skins/door_ginger_a.png - door_ginger_l1,door_ginger_l2,door_ginger_l3,door_ginger_l4 --each
```
Пушки: пряничная (ginger) и ледяная (ice). Мятная и золотая не подходят: так уже выглядят 3-й и 5-й уровни обычной пушки.

Грабли при скачивании: пока картинка не прогрузилась (`naturalWidth` 0), последней «сформированной» оказывается прошлая. Если имя совпало, Chrome сохраняет файл как `имя (1).png`. Сверять размер файла.
