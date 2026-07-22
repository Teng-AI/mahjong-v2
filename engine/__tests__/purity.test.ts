// Hard rule (CLAUDE.md): engine/ stays pure TS with zero Convex imports.
// This test enforces it structurally so a violation fails CI, not review.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE_DIR = join(__dirname, '..');

function engineSourceFiles(): string[] {
  return readdirSync(ENGINE_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(ENGINE_DIR, f));
}

describe('engine purity', () => {
  it('imports nothing from convex, src, or any external package', () => {
    for (const file of engineSourceFiles()) {
      const source = readFileSync(file, 'utf8');
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
        (m) => m[1],
      );
      for (const spec of imports) {
        expect(spec, `${file} imports "${spec}"`).toMatch(/^\.\.?\//);
      }
    }
  });
});
