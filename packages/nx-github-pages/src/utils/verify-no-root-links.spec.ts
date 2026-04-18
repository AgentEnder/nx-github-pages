import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { SKIP_ENV_VAR } from './verify-base-url';
import {
  assertNoRootLinks,
  findRootLinksMissingPrefix,
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

  it('reports href/src attributes that target the site root instead of the prefix', () => {
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

    const offenses = findRootLinksMissingPrefix(dir, 'pr/42');
    expect(offenses).toEqual([
      { file: 'index.html', attribute: 'href', url: '/favicon.ico' },
      { file: 'index.html', attribute: 'href', url: '/docs/start' },
    ]);
  });

  it('ignores protocol-relative and non-root URLs', () => {
    writeFileSync(
      join(dir, 'index.html'),
      [
        '<html><head>',
        '<script src="//cdn.example.com/lib.js"></script>',
        '<link href="https://fonts.example.com/css" rel="stylesheet">',
        '<a href="./relative">rel</a>',
        '<a href="#anchor">anchor</a>',
        '<a href="">empty</a>',
        '</head></html>',
      ].join('\n')
    );

    expect(findRootLinksMissingPrefix(dir, 'pr/42')).toEqual([]);
  });

  it('walks nested directories and aggregates offenses', () => {
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(
      join(dir, 'index.html'),
      '<a href="/top">top</a>'
    );
    writeFileSync(
      join(dir, 'nested/page.html'),
      '<a href="/deep">deep</a><img src="/asset.png">'
    );

    const offenses = findRootLinksMissingPrefix(dir, 'pr/7');
    expect(offenses).toHaveLength(3);
    expect(offenses.map((o) => o.url).sort()).toEqual([
      '/asset.png',
      '/deep',
      '/top',
    ]);
  });

  it('throws a descriptive error when offenses are found', () => {
    writeFileSync(
      join(dir, 'index.html'),
      '<link rel="icon" href="/favicon.ico">'
    );
    expect(() => assertNoRootLinks(dir, 'pr/42')).toThrow(
      /Preview deploy root-link check failed/
    );
    expect(() => assertNoRootLinks(dir, 'pr/42')).toThrow(
      /\/favicon\.ico/
    );
  });

  it(`skips the check when ${SKIP_ENV_VAR}=true`, () => {
    process.env[SKIP_ENV_VAR] = 'true';
    writeFileSync(
      join(dir, 'index.html'),
      '<link rel="icon" href="/favicon.ico">'
    );
    expect(() => assertNoRootLinks(dir, 'pr/42')).not.toThrow();
  });

  it('is a no-op when the directory has no HTML files', () => {
    writeFileSync(join(dir, 'bundle.js'), 'console.log("/foo");');
    expect(findRootLinksMissingPrefix(dir, 'pr/42')).toEqual([]);
    expect(() => assertNoRootLinks(dir, 'pr/42')).not.toThrow();
  });
});
