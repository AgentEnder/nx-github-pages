import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  SKIP_ENV_VAR,
  assertNoRootLinksOutsideBase,
  findRootLinksOutsideBase,
  normalizeBasePath,
} from './verify-no-root-links';

describe('verify-no-root-links', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-ghp-rootlinks-'));
    delete process.env[SKIP_ENV_VAR];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env[SKIP_ENV_VAR];
  });

  describe('normalizeBasePath', () => {
    it('collapses to leading-slash form with no trailing slash', () => {
      expect(normalizeBasePath('/pr/42/')).toBe('/pr/42');
      expect(normalizeBasePath('pr/42')).toBe('/pr/42');
      expect(normalizeBasePath('///nx-github-pages/pr/9//')).toBe(
        '/nx-github-pages/pr/9'
      );
    });

    it('returns "/" for empty or root paths', () => {
      expect(normalizeBasePath('')).toBe('/');
      expect(normalizeBasePath('/')).toBe('/');
    });
  });

  it('reports href/src attributes rooted outside the base path', () => {
    writeFileSync(
      join(dir, 'index.html'),
      [
        '<html><head>',
        '<link rel="icon" href="/favicon.ico">',
        '<script src="/pr/42/assets/main.js"></script>',
        '</head><body>',
        '<a href="/docs/start">Start</a>',
        '<img src="/pr/42/img/logo.svg">',
        '</body></html>',
      ].join('\n')
    );

    const offenses = findRootLinksOutsideBase(dir, '/pr/42');
    expect(offenses).toEqual([
      { file: 'index.html', attribute: 'href', url: '/favicon.ico' },
      { file: 'index.html', attribute: 'href', url: '/docs/start' },
    ]);
  });

  it('accepts any of multiple acceptable base paths', () => {
    writeFileSync(
      join(dir, 'index.html'),
      [
        // bare pathPrefix layout (CNAME)
        '<link rel="icon" href="/pr/42/img/favicon.ico">',
        // repo-prefixed layout (default github.io)
        '<script src="/my-repo/pr/42/assets/main.js"></script>',
        // not in either → offense
        '<a href="/docs/intro">bad</a>',
      ].join('\n')
    );

    const offenses = findRootLinksOutsideBase(dir, [
      '/pr/42',
      '/my-repo/pr/42',
    ]);
    expect(offenses.map((o) => o.url)).toEqual(['/docs/intro']);
  });

  it('treats a rooted link exactly equal to the base as in-scope', () => {
    writeFileSync(
      join(dir, 'index.html'),
      '<a href="/pr/42">home</a><a href="/pr/42/">home2</a>'
    );
    expect(findRootLinksOutsideBase(dir, '/pr/42')).toEqual([]);
  });

  it('ignores protocol-relative, relative, fragment, and empty URLs', () => {
    writeFileSync(
      join(dir, 'index.html'),
      [
        '<script src="//cdn.example.com/lib.js"></script>',
        '<link href="https://fonts.example.com/css" rel="stylesheet">',
        '<a href="./relative">rel</a>',
        '<a href="#anchor">anchor</a>',
        '<a href="">empty</a>',
      ].join('\n')
    );

    expect(findRootLinksOutsideBase(dir, '/pr/42')).toEqual([]);
  });

  it('ignores the <base> tag — it declares the document base, not a link', () => {
    writeFileSync(
      join(dir, 'index.html'),
      [
        '<!doctype html>',
        '<html><head>',
        '<base href="/" />',
        '<script type="module" src="/pr/42/assets/main.js"></script>',
        '</head></html>',
      ].join('\n')
    );
    expect(findRootLinksOutsideBase(dir, '/pr/42')).toEqual([]);
  });

  it('walks nested directories and aggregates offenses', () => {
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<a href="/top">top</a>');
    writeFileSync(
      join(dir, 'nested/page.html'),
      '<a href="/deep">deep</a><img src="/asset.png">'
    );

    const offenses = findRootLinksOutsideBase(dir, '/pr/7');
    expect(offenses).toHaveLength(3);
    expect(offenses.map((o) => o.url).sort()).toEqual([
      '/asset.png',
      '/deep',
      '/top',
    ]);
  });

  it('is a no-op when all supplied base paths reduce to "/"', () => {
    writeFileSync(join(dir, 'index.html'), '<a href="/anything">a</a>');
    expect(findRootLinksOutsideBase(dir, '/')).toEqual([]);
    expect(findRootLinksOutsideBase(dir, ['/', ''])).toEqual([]);
    expect(() => assertNoRootLinksOutsideBase(dir, '/')).not.toThrow();
  });

  it('throws a descriptive error listing all accepted bases', () => {
    writeFileSync(
      join(dir, 'index.html'),
      '<link rel="icon" href="/favicon.ico">'
    );
    const assertion = () =>
      assertNoRootLinksOutsideBase(dir, ['/pr/42', '/my-repo/pr/42']);
    expect(assertion).toThrow(/base URL check failed/i);
    expect(assertion).toThrow(/favicon\.ico/);
    expect(assertion).toThrow(/\/pr\/42\//);
    expect(assertion).toThrow(/\/my-repo\/pr\/42\//);
    expect(assertion).toThrow(new RegExp(SKIP_ENV_VAR));
  });

  it(`skips the check when ${SKIP_ENV_VAR}=true`, () => {
    process.env[SKIP_ENV_VAR] = 'true';
    writeFileSync(
      join(dir, 'index.html'),
      '<link rel="icon" href="/favicon.ico">'
    );
    expect(() => assertNoRootLinksOutsideBase(dir, '/pr/42')).not.toThrow();
  });

  it('is a no-op when the directory has no HTML files', () => {
    writeFileSync(join(dir, 'bundle.js'), 'console.log("/foo");');
    expect(findRootLinksOutsideBase(dir, '/pr/42')).toEqual([]);
    expect(() => assertNoRootLinksOutsideBase(dir, '/pr/42')).not.toThrow();
  });
});
