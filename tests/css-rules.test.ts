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
});
