import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Phaser переиспользует объект GameScene между матчами. Поле с начальным значением,
 * которое не сброшено в init(), переживает матч: так `caughtPaused` после
 * «Тебя поймали → Выйти в меню» замораживал следующий матч (GAME_AUDIT.md, B1).
 * Сцену без браузера не поднять, поэтому проверяем исходник: каждое такое поле
 * обязано присваиваться в init().
 */
const src = readFileSync(fileURLToPath(new URL('../src/view/GameScene.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** Поля класса с инициализатором: `  private name = …` или `  private name: T = …` (в T бывает `=>`). */
function statefulFields(code: string): string[] {
  const re = /^ {2}private (?:readonly )?([a-zA-Z]+)(?::[^\n]+?)?\s=\s/gm;
  return [...code.matchAll(re)].map((m) => m[1]);
}

function initBody(code: string): string {
  const start = code.indexOf('  init(data: GameData): void {');
  const end = code.indexOf('\n  }\n', start);
  return code.slice(start, end);
}

describe('GameScene: сброс состояния между матчами', () => {
  it('test_scene_init_resets_every_stateful_field', () => {
    // Arrange
    const fields = statefulFields(src);
    const init = initBody(src);

    // Act
    const missing = fields.filter((f) => !new RegExp(`this\\.${f}\\s*=`).test(init));

    // Assert
    expect(fields).toContain('caughtPaused');
    expect(missing).toEqual([]);
  });
});
