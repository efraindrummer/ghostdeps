import { describe, expect, it } from 'vitest';
import { normalizeRepository } from '../src/parser/repoUrl.js';

describe('normalizeRepository', () => {
  it.each([
    'git+https://github.com/expressjs/express.git',
    'https://github.com/expressjs/express',
    'https://www.github.com/expressjs/express.git',
    'git://github.com/expressjs/express.git',
    'git+ssh://git@github.com/expressjs/express.git',
    'ssh://git@github.com/expressjs/express.git',
    'git@github.com:expressjs/express.git',
    'github:expressjs/express',
    'expressjs/express',
    'github.com/expressjs/express',
    'https://github.com/expressjs/express.git#main',
  ])('%s => github expressjs/express', (input) => {
    const ref = normalizeRepository(input);
    expect(ref).toMatchObject({ host: 'github', owner: 'expressjs', repo: 'express', url: 'https://github.com/expressjs/express' });
  });

  it('acepta el objeto {type,url,directory} de monorepos', () => {
    const ref = normalizeRepository({ type: 'git', url: 'https://github.com/babel/babel.git', directory: 'packages/babel-core/' });
    expect(ref).toMatchObject({ owner: 'babel', repo: 'babel', directory: 'packages/babel-core' });
  });

  it('extrae el directorio de URLs /tree/<rama>/<dir>', () => {
    const ref = normalizeRepository('https://github.com/vercel/next.js/tree/canary/packages/next');
    expect(ref).toMatchObject({ owner: 'vercel', repo: 'next.js', directory: 'packages/next' });
  });

  it('detecta GitLab y Bitbucket', () => {
    expect(normalizeRepository('gitlab:foo/bar')?.host).toBe('gitlab');
    expect(normalizeRepository('git+https://gitlab.com/foo/bar.git')?.host).toBe('gitlab');
    expect(normalizeRepository('bitbucket:foo/bar')?.host).toBe('bitbucket');
    expect(normalizeRepository('git@git.example.com:team/lib.git')).toMatchObject({ host: 'other', hostname: 'git.example.com' });
  });

  it.each([undefined, null, '', '   ', {}, { url: 42 }, 'not a url', 'https://github.com/onlyowner'])(
    'devuelve null para entradas inválidas: %j',
    (input) => {
      expect(normalizeRepository(input)).toBeNull();
    },
  );
});
