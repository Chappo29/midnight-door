import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Регрессии CSS, которые ломали вид или доступность целых экранов (GAME_AUDIT.md). */
const css = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** Тело первого правила с точно таким селектором. */
function rule(selector: string): string | null {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('style.css', () => {
  it('test_ui_button_reset_does_not_override_button_classes', () => {
    // `#ui button` (1,0,1) сильнее `.btn-big` (0,1,0): сброс шрифта/цвета в нём
    // делал «Играть», «Ещё раз», «Забрать» мелким тонким текстом (UI1).
    const strong = rule('#ui button');
    expect(strong).not.toBeNull();
    // Свойство целиком, а не хвост вроде -webkit-tap-highlight-color.
    expect(strong).not.toMatch(/(?:^|[\s;])(?:font|color)\s*:/);
    expect(strong).toMatch(/pointer-events:\s*auto/);
    expect(rule(':where(#ui) button')).toMatch(/font:\s*inherit/);
  });

  it('test_result_card_stays_scrollable_on_low_screens', () => {
    // .halftone объявлен после .card с той же специфичностью: overflow:hidden в нём отключал
    // прокрутку, и на телефоне в альбоме кнопки «Ещё раз»/«Меню» были недостижимы (B2).
    expect(rule('.card')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.halftone')).not.toMatch(/overflow\s*:/);
    expect(css).toMatch(/@media \(max-height: 500px\)[\s\S]*?\.result-card \.result-mascot/);
  });

  it('test_ad_buttons_and_daily_fit_low_landscape_screens', () => {
    // QA-06: «×2 монеты», «Вернуться в комнату» и подарок дня выталкивали главные кнопки за край на телефоне лёжа.
    const low = [...css.matchAll(/@media \(max-height: 500px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(low).toMatch(/\.caught-card \.result-mascot \{\s*display: none/);
    expect(low).toMatch(/\.caught-card \.btn-big,\s*\.result-card \.btn-big \{[^}]*min-height: 48px/);
    expect(low).toMatch(/\.card\.daily-card \{[^}]*padding/);
    expect(low).toMatch(/\.daily-tile \{[^}]*min-height: 48px/);
  });

  it('test_build_menu_fits_low_landscape_screens', () => {
    // UX-16: на телефоне лёжа тело меню было 58 % высоты окна, и холодильник уезжал под край (нужна прокрутка).
    const low = [...css.matchAll(/@media \(max-height: 500px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(low).toMatch(/#menu \.menu-body \{[^}]*max-height: calc\(100vh - 90px\)/);
    expect(low).toMatch(/#menu \.opt \{[^}]*min-height: 50px/);
    // Только внутри #menu: .menu-title есть и в заголовке главного меню.
    expect(low).not.toMatch(/(^|\n)\s*\.menu-title \{/);
  });

  it('test_daily_low_screen_rules_come_after_base_daily_and_card_rules', () => {
    // Правила низкого экрана для подарка стояли до базовых .daily-* и общих .card — и молча проигрывали им.
    const lowDaily = css.lastIndexOf('.card.daily-card {');
    expect(lowDaily).toBeGreaterThan(css.lastIndexOf('\n.daily-card {'));
    expect(lowDaily).toBeGreaterThan(css.lastIndexOf('\n.daily-tile {'));
    expect(lowDaily).toBeGreaterThan(css.lastIndexOf('  .card {'));
  });

  it('test_tutorial_skip_button_follows_the_narrowed_game_area_on_wide_desktops', () => {
    // На ПК шире 2:1 колонка паузы/звука сжата до 200vh, а кнопка пропуска лежит вне #ui — без сдвига она стояла у края окна отдельно.
    const wide = [...css.matchAll(/@media \(hover: hover\) and \(pointer: fine\) and \(min-aspect-ratio: 2\/1\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(wide).toMatch(/\.tut-skip\.bare \{[^}]*right: calc\([^}]*\(100vw - 200vh\) \/ 2/);
    // Правило стоит после базового `.tut-skip.bare { right … }`.
    expect(css.lastIndexOf('.tut-skip.bare {')).toBeGreaterThan(css.indexOf('.tut-skip.bare {'));
  });
});
