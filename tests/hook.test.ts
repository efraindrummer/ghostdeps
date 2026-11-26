import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installGitHook } from '../src/hooks/githook.js';

describe('installGitHook', () => {
  it('instala pre-commit hook de Git estándar en .git/hooks/pre-commit', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'ghostdeps-git-hook-'));
    const res = await installGitHook(tmp, { failUnder: 55, dryRun: false });

    expect(res.success).toBe(true);
    expect(res.type).toBe('git');
    expect(res.hookPath).toContain(path.join('.git', 'hooks', 'pre-commit'));

    const content = await readFile(res.hookPath, 'utf8');
    expect(content).toContain('ghostdeps --fail-under 55');
    expect(content).toContain('#!/bin/sh');

    await rm(tmp, { recursive: true, force: true });
  });

  it('no escribe en disco en modo dry-run', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'ghostdeps-dry-hook-'));
    const res = await installGitHook(tmp, { failUnder: 60, dryRun: true });

    expect(res.success).toBe(true);
    expect(res.content).toContain('ghostdeps --fail-under 60');

    let exists = false;
    try {
      await readFile(res.hookPath, 'utf8');
      exists = true;
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);

    await rm(tmp, { recursive: true, force: true });
  });
});
