/**
 * Generador e instalador de Git Hooks para prevenir la introducción de dependencias
 * fantasmas, secuestradas o con install scripts maliciosos antes de hacer commit.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface InstallHookResult {
  success: boolean;
  hookPath: string;
  type: 'husky' | 'git';
  content: string;
  alreadyExisted: boolean;
}

export async function installGitHook(
  dir: string,
  options: { failUnder?: number; dryRun?: boolean } = {},
): Promise<InstallHookResult> {
  const threshold = options.failUnder ?? 50;
  const huskyDir = path.resolve(dir, '.husky');
  const gitDir = path.resolve(dir, '.git');

  let type: 'husky' | 'git' = 'git';
  let hookPath: string;

  const isHusky = await (async () => {
    try {
      await readFile(path.join(huskyDir, '_', 'husky.sh'));
      return true;
    } catch {
      try {
        await readFile(path.join(huskyDir, 'pre-commit'));
        return true;
      } catch {
        return false;
      }
    }
  })();

  if (isHusky) {
    type = 'husky';
    hookPath = path.join(huskyDir, 'pre-commit');
  } else {
    type = 'git';
    hookPath = path.join(gitDir, 'hooks', 'pre-commit');
  }

  let alreadyExisted = false;
  let existingContent = '';
  try {
    existingContent = await readFile(hookPath, 'utf8');
    alreadyExisted = true;
  } catch {
    alreadyExisted = false;
  }

  const hookCommand = `npx --yes @efraindrummer/ghostdeps --fail-under ${threshold}`;

  let newContent = '';
  if (type === 'husky') {
    if (existingContent.includes('ghostdeps')) {
      newContent = existingContent;
    } else {
      newContent = existingContent ? `${existingContent.trim()}\n${hookCommand}\n` : `${hookCommand}\n`;
    }
  } else {
    // Git hook standard
    if (existingContent.includes('ghostdeps')) {
      newContent = existingContent;
    } else if (existingContent) {
      newContent = `${existingContent.trim()}\n\n# GhostDeps Quality Gate\n${hookCommand}\n`;
    } else {
      newContent = `#!/bin/sh\n# GhostDeps Pre-commit Hook\n${hookCommand}\n`;
    }
  }

  if (!options.dryRun) {
    await mkdir(path.dirname(hookPath), { recursive: true });
    await writeFile(hookPath, newContent, 'utf8');
    try {
      await chmod(hookPath, 0o755);
    } catch {
      // Ignorar en sistemas que no soportan chmod (ej. Windows FAT/NTFS sin POSIX)
    }
  }

  return {
    success: true,
    hookPath,
    type,
    content: newContent,
    alreadyExisted,
  };
}
