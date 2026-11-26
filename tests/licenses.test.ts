import { describe, expect, it } from 'vitest';
import { checkLicenseCompliance, normalizeLicense } from '../src/security/licenses.js';

describe('normalizeLicense', () => {
  it('normaliza variantes comunes', () => {
    expect(normalizeLicense('Apache 2.0')).toBe('Apache-2.0');
    expect(normalizeLicense('mit')).toBe('MIT');
    expect(normalizeLicense('BSD 3-Clause')).toBe('BSD-3-Clause');
    expect(normalizeLicense('')).toBe('UNKNOWN');
    expect(normalizeLicense(null)).toBe('UNKNOWN');
  });
});

describe('checkLicenseCompliance', () => {
  it('aprueba licencias permisivas sin restricciones', () => {
    const res = checkLicenseCompliance('MIT');
    expect(res.license).toBe('MIT');
    expect(res.isCopyleft).toBe(false);
    expect(res.isDenied).toBe(false);
  });

  it('detecta licencias copyleft (GPL, AGPL)', () => {
    const res1 = checkLicenseCompliance('GPL-3.0');
    expect(res1.isCopyleft).toBe(true);

    const res2 = checkLicenseCompliance('AGPL-3.0-or-later');
    expect(res2.isCopyleft).toBe(true);
  });

  it('deniega licencias explícitamente denegadas por el usuario', () => {
    const res = checkLicenseCompliance('GPL-3.0', {
      deniedLicenses: ['GPL-3.0', 'AGPL-3.0'],
    });
    expect(res.isDenied).toBe(true);
    expect(res.reason).toContain('denegada explícitamente');
  });

  it('deniega licencias que no estén en la lista blanca allowedLicenses', () => {
    const res = checkLicenseCompliance('BSD-3-Clause', {
      allowedLicenses: ['MIT', 'Apache-2.0'],
    });
    expect(res.isDenied).toBe(true);
    expect(res.reason).toContain('no forma parte de las licencias permitidas');
  });

  it('marca paquetes sin licencia (UNKNOWN o UNLICENSED)', () => {
    const res = checkLicenseCompliance(null);
    expect(res.isUnlicensed).toBe(true);
    expect(res.reason).toContain('sin licencia formal');
  });
});
