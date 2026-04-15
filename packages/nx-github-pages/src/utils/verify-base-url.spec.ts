import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  SKIP_ENV_VAR,
  assertBaseUrlInBundle,
  verifyBaseUrlInBundle,
} from './verify-base-url';

describe('verify-base-url', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nx-ghp-verify-'));
    delete process.env[SKIP_ENV_VAR];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env[SKIP_ENV_VAR];
  });

  it('passes when the path prefix appears in an HTML asset reference', () => {
    writeFileSync(
      join(dir, 'index.html'),
      '<html><head><script src="/pr/123/assets/main.js"></script></head></html>'
    );

    const result = verifyBaseUrlInBundle(dir, 'pr/123');
    expect(result.ok).toBe(true);
    expect(result.matchedFile).toContain('index.html');
  });

  it('passes when the path prefix appears in a nested JS file', () => {
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<html><body></body></html>');
    writeFileSync(
      join(dir, 'assets', 'main.js'),
      'const base = "/pr/42/";\nfetch(base + "data.json");'
    );

    const result = verifyBaseUrlInBundle(dir, '/pr/42/');
    expect(result.ok).toBe(true);
  });

  it('fails when the path prefix is not found anywhere', () => {
    writeFileSync(
      join(dir, 'index.html'),
      '<html><head><script src="/assets/main.js"></script></head></html>'
    );

    const result = verifyBaseUrlInBundle(dir, 'pr/123');
    expect(result.ok).toBe(false);
    expect(result.scannedFiles).toBeGreaterThan(0);
  });

  it('skips directories like node_modules and .git', () => {
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    mkdirSync(join(dir, '.git'), { recursive: true });
    // These files contain the needle but should NOT count.
    writeFileSync(join(dir, 'node_modules', 'fake.js'), '"pr/999"');
    writeFileSync(join(dir, '.git', 'HEAD'), 'pr/999');
    writeFileSync(
      join(dir, 'index.html'),
      '<html><body>nothing here</body></html>'
    );

    const result = verifyBaseUrlInBundle(dir, 'pr/999');
    expect(result.ok).toBe(false);
  });

  describe('assertBaseUrlInBundle', () => {
    it('throws a descriptive error when check fails', () => {
      writeFileSync(join(dir, 'index.html'), '<html></html>');
      expect(() => assertBaseUrlInBundle(dir, 'pr/7')).toThrow(
        /Preview deploy base URL check failed/
      );
      expect(() => assertBaseUrlInBundle(dir, 'pr/7')).toThrow(
        /NX_GITHUB_PAGES_SKIP_BASE_URL_CHECK=true/
      );
    });

    it('does not throw when the env var bypass is set', () => {
      writeFileSync(join(dir, 'index.html'), '<html></html>');
      process.env[SKIP_ENV_VAR] = 'true';
      expect(() => assertBaseUrlInBundle(dir, 'pr/7')).not.toThrow();
    });

    it('does not throw when the check passes', () => {
      writeFileSync(
        join(dir, 'index.html'),
        '<html><script src="/pr/7/main.js"></script></html>'
      );
      expect(() => assertBaseUrlInBundle(dir, 'pr/7')).not.toThrow();
    });
  });
});
