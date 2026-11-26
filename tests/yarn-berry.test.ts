import { describe, expect, it } from 'vitest';
import { parseYarnLock, resolveTransitive } from '../src/parser/lockfile.js';
import type { DependencySpec } from '../src/types.js';

const SAMPLE_YARN_BERRY = `
__metadata:
  version: 6
  cacheKey: 8

"express@npm:^4.18.2":
  version: 4.18.2
  resolution: "express@npm:4.18.2"
  dependencies:
    accepts: "npm:1.3.8"
    qs: "npm:6.11.0"
  checksum: 10/abcdef

"accepts@npm:1.3.8":
  version: 1.3.8
  resolution: "accepts@npm:1.3.8"
  dependencies:
    mime-types: "npm:2.1.35"
  checksum: 10/123456

"mime-types@npm:2.1.35":
  version: 2.1.35
  resolution: "mime-types@npm:2.1.35"
  checksum: 10/789012

"qs@npm:6.11.0":
  version: 6.11.0
  resolution: "qs@npm:6.11.0"
  checksum: 10/345678
`;

describe('parseYarnLock con Yarn Berry (v2-v4)', () => {
  it('parsea paquetes con descriptores @npm: y resolución moderna', () => {
    const lock = parseYarnLock(SAMPLE_YARN_BERRY);
    expect(lock.type).toBe('yarn');

    // Comprobar que registró tanto la clave raw como la normalizada
    expect(lock.entries.has('express@npm:^4.18.2')).toBe(true);
    expect(lock.entries.has('express@^4.18.2')).toBe(true);

    const expressPkg = lock.entries.get('express@^4.18.2');
    expect(expressPkg?.version).toBe('4.18.2');
    expect(expressPkg?.dependencies['accepts']).toBe('1.3.8');
    expect(expressPkg?.dependencies['qs']).toBe('6.11.0');
  });

  it('resuelve dependencias transitivas en Yarn Berry', () => {
    const lock = parseYarnLock(SAMPLE_YARN_BERRY);
    const direct: DependencySpec[] = [
      { name: 'express', registryName: 'express', spec: '^4.18.2', kind: 'dependencies', depth: 1, via: [] },
    ];

    const trans = resolveTransitive(lock, direct, { maxDepth: 10 });
    const names = trans.map((d) => d.name).sort();

    expect(names).toEqual(['accepts', 'mime-types', 'qs']);

    const mimeTypes = trans.find((d) => d.name === 'mime-types');
    expect(mimeTypes?.depth).toBe(3); // express(1) -> accepts(2) -> mime-types(3)
    expect(mimeTypes?.via).toEqual(['express', 'accepts']);
  });
});
