/**
 * Módulo de detección de Typosquatting y confusión de dependencias.
 * Compara las dependencias analizadas contra un registro de paquetes populares de npm
 * calculando distancia de Levenshtein y normalización de separadores.
 */

export interface TyposquatMatch {
  suspectName: string;
  targetPackage: string;
  similarityReason: string;
  distance: number;
}

/**
 * Top 120 paquetes más populares y atacados del ecosistema npm.
 */
export const TOP_NPM_PACKAGES: readonly string[] = Object.freeze([
  'express',
  'react',
  'react-dom',
  'vue',
  'angular',
  'lodash',
  'axios',
  'chalk',
  'commander',
  'debug',
  'dotenv',
  'moment',
  'request',
  'uuid',
  'winston',
  'typescript',
  'tslib',
  'glob',
  'semver',
  'rxjs',
  'webpack',
  'esbuild',
  'vite',
  'cross-env',
  'core-js',
  'body-parser',
  'cookie-parser',
  'cors',
  'fs-extra',
  'async',
  'yargs',
  'prettier',
  'eslint',
  'postcss',
  'rimraf',
  'mkdirp',
  'minimist',
  'inquirer',
  'nodemon',
  'superagent',
  'mongoose',
  'sequelize',
  'prisma',
  'next',
  'jest',
  'vitest',
  'mocha',
  'chai',
  'bcrypt',
  'jsonwebtoken',
  'passport',
  'socket.io',
  'cheerio',
  'sharp',
  'puppeteer',
  'playwright',
  'babel-core',
  'webpack-cli',
  'ts-node',
  'colors',
  'chokidar',
  'nanoid',
  'ora',
  'nodemailer',
  'ioredis',
  'redis',
  'pg',
  'mysql2',
  'ws',
  'fastify',
  'got',
  'node-fetch',
  'undici',
  'dayjs',
  'date-fns',
  'zod',
  'yup',
  'joi',
  'dotenv-expand',
  'dotenv-safe',
  'commander',
  'minimatch',
  'source-map',
  'path-to-regexp',
  'tar',
  'archiver',
  'adm-zip',
  'yaml',
  'multer',
  'helmet',
  'morgan',
  'node-sass',
  'sass',
  'less',
  'pnpm',
  'yarn',
  'npm',
]);

/**
 * Distancia de Levenshtein (número mínimo de inserciones, borrados o sustituciones).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1]! : Math.min(row[j - 1]!, row[j]!, prev) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length]!;
}

/**
 * Inspecciona un nombre de paquete para determinar si es un intento de typosquatting.
 */
export function detectTyposquatting(
  packageName: string,
  topPackages: readonly string[] = TOP_NPM_PACKAGES,
): TyposquatMatch | null {
  const normalizedSuspect = packageName.toLowerCase().trim();
  // Extraer el nombre base si tiene scope (@scope/pkg -> pkg)
  const baseSuspect = normalizedSuspect.startsWith('@')
    ? (normalizedSuspect.split('/')[1] ?? normalizedSuspect)
    : normalizedSuspect;

  // Si es exactamente el paquete legítimo, no es typosquatting
  if (topPackages.includes(baseSuspect)) {
    return null;
  }

  const strippedSuspect = baseSuspect.replace(/[-_.]/g, '');

  for (const target of topPackages) {
    const strippedTarget = target.replace(/[-_.]/g, '');

    // 1. Caso separadores omitidos o cambiados: e.g. "crossenv" vs "cross-env", "fsextra" vs "fs-extra"
    if (strippedSuspect === strippedTarget && baseSuspect !== target) {
      return {
        suspectName: packageName,
        targetPackage: target,
        similarityReason: `Nombre idéntico omitiendo o alterando separadores respecto al popular "${target}"`,
        distance: 1,
      };
    }

    // 2. Distancia de Levenshtein = 1 (e.g. "loadsh" -> "lodash", "cha1k" -> "chalk")
    if (Math.abs(baseSuspect.length - target.length) <= 1 && target.length >= 4) {
      const dist = levenshtein(baseSuspect, target);
      if (dist === 1) {
        return {
          suspectName: packageName,
          targetPackage: target,
          similarityReason: `Difiere por solo 1 carácter del paquete popular "${target}" (posible engaño visual)`,
          distance: 1,
        };
      }
    }

    // 3. Distancia de Levenshtein = 2 para paquetes largos (>= 8 caracteres)
    if (Math.abs(baseSuspect.length - target.length) <= 2 && target.length >= 8) {
      const dist = levenshtein(baseSuspect, target);
      if (dist === 2) {
        return {
          suspectName: packageName,
          targetPackage: target,
          similarityReason: `Difiere por 2 caracteres del paquete popular "${target}"`,
          distance: 2,
        };
      }
    }
  }

  return null;
}
