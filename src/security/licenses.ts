/**
 * Módulo de auditoría y compliance legal de licencias de software.
 * Clasifica licencias permisivas vs copyleft (GPL/AGPL) y evalúa
 * reglas de inclusión/exclusión del proyecto.
 */

export interface LicenseCheckResult {
  license: string;
  isCopyleft: boolean;
  isDenied: boolean;
  isUnlicensed: boolean;
  reason?: string;
}

const COPYLEFT_REGEX = /\b(gpl|agpl|lgpl|sspl|eupl|osl)\b/i;

/**
 * Normaliza nombres de licencias (ej. "Apache 2.0" -> "Apache-2.0").
 */
export function normalizeLicense(lic: string | null | undefined): string {
  if (!lic || !lic.trim()) return 'UNKNOWN';
  const clean = lic.trim();
  if (/^apache\s*2(\.0)?$/i.test(clean)) return 'Apache-2.0';
  if (/^bsd\s*3[\s-]*clause$/i.test(clean)) return 'BSD-3-Clause';
  if (/^bsd\s*2[\s-]*clause$/i.test(clean)) return 'BSD-2-Clause';
  if (/^mit$/i.test(clean)) return 'MIT';
  if (/^isc$/i.test(clean)) return 'ISC';
  return clean;
}

export function checkLicenseCompliance(
  rawLicense: string | null | undefined,
  options: {
    allowedLicenses?: string[];
    deniedLicenses?: string[];
  } = {},
): LicenseCheckResult {
  const license = normalizeLicense(rawLicense);
  const isUnlicensed =
    license === 'UNKNOWN' ||
    /^unlicensed$/i.test(license) ||
    /^see license in/i.test(license);

  const isCopyleft = COPYLEFT_REGEX.test(license);

  const allowed = options.allowedLicenses?.map((l) => l.trim().toLowerCase());
  const denied = options.deniedLicenses?.map((l) => l.trim().toLowerCase());

  let isDenied = false;
  let reason: string | undefined;

  const licLower = license.toLowerCase();

  if (denied && denied.some((d) => licLower === d || licLower.includes(d))) {
    isDenied = true;
    reason = `Licencia "${license}" denegada explícitamente por política del proyecto`;
  } else if (allowed && allowed.length > 0 && !allowed.some((a) => licLower === a || licLower.includes(a))) {
    isDenied = true;
    reason = `Licencia "${license}" no forma parte de las licencias permitidas`;
  } else if (isUnlicensed) {
    reason = 'Dependencia sin licencia formal declarada (riesgo de propiedad intelectual)';
  } else if (isCopyleft) {
    reason = `Licencia con cláusula Copyleft (${license}) que puede comprometer código privativo`;
  }

  return {
    license,
    isCopyleft,
    isDenied,
    isUnlicensed,
    reason,
  };
}
