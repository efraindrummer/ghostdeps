import { describe, expect, it } from 'vitest';
import { parsePnpmLock, resolveTransitive } from '../src/parser/lockfile.js';
import type { DependencySpec } from '../src/types.js';

const SAMPLE_PNPM_LOCK = `
lockfileVersion: '6.0'

settings:
  autoInstallPeers: true

dependencies:
  express:
    specifier: ^4.18.2
    version: 4.18.2

packages:

  /accepts@1.3.8:
    resolution: {integrity: sha512-pySteJ+50MQThzyB3JKHKU9b5DloV95AffGhQDnnI40S577K13vMTcvEq6tw45CFSDhyOXY3BgP+Sntvy2Zt9Q==}
    dependencies:
      mime-types: 2.1.35
      negotiator: 0.6.3
    dev: false

  /express@4.18.2:
    resolution: {integrity: sha512-5/PsL6iVEG4S8LQGLdQxUwZJS4828Ygf+QQZg3MGhdMv04gGv48C54590qP00h95HC93vU58hVcU1eyyb5GBAA==}
    dependencies:
      accepts: 1.3.8
      qs: 6.11.0
    dev: false

  /mime-types@2.1.35:
    resolution: {integrity: sha512-ZDY+bPm5zTTF+YpCrAU9nK0UgICYPT0QtT1NZWFv4s++TNkcgVaT0g6+4R2uI4MjQjzysHB1zxuWL50hzae6iw==}
    dependencies:
      mime-db: 1.52.0
    dev: false

  /mime-db@1.52.0:
    resolution: {integrity: sha512-sPU4uV7dYZvtWtRRCGwJwZKrRFFinXPnu/HECm4IQMHVeEKmA8gFoI0Tl6URZQuDpTKQJSII70n0W0485KD98A==}
    dev: false

  /negotiator@0.6.3:
    resolution: {integrity: sha512-+EUsqGPLsM+j/zdChZjsnX51g4XrHFOIXwfnCVPGlQk/wf5303Gvtvk3+6V37m83ATj82qGVgVCpeLfKgEocoA==}
    dev: false

  /qs@6.11.0:
    resolution: {integrity: sha512-MvjoMCJwEarSbUYk5RYtuLSMHMRUzVSuLZAPZzsHTZZsURZPu262hVIhtkV5qxD8PzVZKR7RefxCgoFH3b+YtQ==}
    dev: false
`;

describe('parsePnpmLock', () => {
  it('parsea paquetes y dependencias anidadas de pnpm-lock.yaml', () => {
    const lock = parsePnpmLock(SAMPLE_PNPM_LOCK);
    expect(lock.type).toBe('pnpm');
    expect(lock.packages.has('express@4.18.2')).toBe(true);
    expect(lock.packages.has('accepts@1.3.8')).toBe(true);
    expect(lock.packages.has('mime-types@2.1.35')).toBe(true);

    const expressPkg = lock.packages.get('express@4.18.2');
    expect(expressPkg?.dependencies['accepts']).toBe('1.3.8');
    expect(expressPkg?.dependencies['qs']).toBe('6.11.0');
  });
});

describe('resolveTransitive con pnpm', () => {
  it('resuelve transitivas en BFS deduplicadas', () => {
    const lock = parsePnpmLock(SAMPLE_PNPM_LOCK);
    const direct: DependencySpec[] = [
      { name: 'express', registryName: 'express', spec: '^4.18.2', kind: 'dependencies', depth: 1, via: [] },
    ];

    const trans = resolveTransitive(lock, direct, { maxDepth: 10 });
    const names = trans.map((d) => d.name).sort();

    // express -> accepts, qs; accepts -> mime-types, negotiator; mime-types -> mime-db
    expect(names).toEqual(['accepts', 'mime-db', 'mime-types', 'negotiator', 'qs']);

    const mimeDb = trans.find((d) => d.name === 'mime-db');
    expect(mimeDb?.depth).toBe(4); // express(1) -> accepts(2) -> mime-types(3) -> mime-db(4)
    expect(mimeDb?.via).toEqual(['express', 'accepts', 'mime-types']);
  });

  it('respeta la opción maxDepth', () => {
    const lock = parsePnpmLock(SAMPLE_PNPM_LOCK);
    const direct: DependencySpec[] = [
      { name: 'express', registryName: 'express', spec: '^4.18.2', kind: 'dependencies', depth: 1, via: [] },
    ];

    const trans = resolveTransitive(lock, direct, { maxDepth: 2 });
    const names = trans.map((d) => d.name).sort();

    // Solo nivel 2 (hijos directos de express): accepts, qs
    expect(names).toEqual(['accepts', 'qs']);
  });
});
