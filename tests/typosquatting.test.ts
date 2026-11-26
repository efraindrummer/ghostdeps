import { describe, expect, it } from 'vitest';
import { detectTyposquatting, levenshtein } from '../src/security/typosquatting.js';

describe('levenshtein', () => {
  it('calcula distancia de edición correctamente', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('lodash', 'loadsh')).toBe(2);
    expect(levenshtein('chalk', 'cha1k')).toBe(1);
    expect(levenshtein('express', 'express')).toBe(0);
  });
});

describe('detectTyposquatting', () => {
  it('no marca paquetes legítimos populares', () => {
    expect(detectTyposquatting('express')).toBeNull();
    expect(detectTyposquatting('lodash')).toBeNull();
    expect(detectTyposquatting('cross-env')).toBeNull();
    expect(detectTyposquatting('react')).toBeNull();
  });

  it('detecta omisión o alteración de separadores (crossenv vs cross-env)', () => {
    const res = detectTyposquatting('crossenv');
    expect(res).not.toBeNull();
    expect(res?.targetPackage).toBe('cross-env');
    expect(res?.similarityReason).toContain('cross-env');
  });

  it('detecta suplantaciones por distancia de 1 carácter (cha1k, exprss)', () => {
    const res1 = detectTyposquatting('cha1k');
    expect(res1).not.toBeNull();
    expect(res1?.targetPackage).toBe('chalk');

    const res2 = detectTyposquatting('exprss');
    expect(res2).not.toBeNull();
    expect(res2?.targetPackage).toBe('express');
  });

  it('ignora paquetes no relacionados que no se parecen a los top', () => {
    expect(detectTyposquatting('super-unique-internal-tool-xyz')).toBeNull();
    expect(detectTyposquatting('my-custom-logger-backend')).toBeNull();
  });
});
