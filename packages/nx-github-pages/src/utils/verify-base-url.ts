import { logger } from '@nx/devkit';
import type { Dirent } from 'fs';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

export const SKIP_ENV_VAR = 'NX_GITHUB_PAGES_SKIP_BASE_URL_CHECK';

const SCANNED_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.map',
  '.json',
]);

const MAX_FILES = 500;
const MAX_BYTES_PER_FILE = 10 * 1024 * 1024;

function* walk(dir: string): Generator<string> {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      const dotIdx = entry.name.lastIndexOf('.');
      if (dotIdx < 0) continue;
      const ext = entry.name.slice(dotIdx).toLowerCase();
      if (SCANNED_EXTENSIONS.has(ext)) {
        yield full;
      }
    }
  }
}

function readCapped(path: string): string {
  try {
    const { size } = statSync(path);
    if (size > MAX_BYTES_PER_FILE) return '';
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

export interface VerifyBaseUrlResult {
  ok: boolean;
  scannedFiles: number;
  matchedFile?: string;
}

export function verifyBaseUrlInBundle(
  directory: string,
  pathPrefix: string
): VerifyBaseUrlResult {
  // The string we look for is the prefix without leading/trailing slashes.
  // This matches both absolute (`/pr/123/`) and relative (`./pr/123/`) base
  // URL emissions across frameworks.
  const needle = pathPrefix.replace(/^\/+|\/+$/g, '');
  if (!needle) {
    return { ok: true, scannedFiles: 0 };
  }

  let scanned = 0;
  for (const file of walk(directory)) {
    if (scanned >= MAX_FILES) break;
    scanned++;
    const content = readCapped(file);
    if (content.includes(needle)) {
      return { ok: true, scannedFiles: scanned, matchedFile: file };
    }
  }
  return { ok: false, scannedFiles: scanned };
}

export function assertBaseUrlInBundle(
  directory: string,
  pathPrefix: string
): void {
  if (process.env[SKIP_ENV_VAR] === 'true') {
    logger.warn(
      `Skipping base URL check because ${SKIP_ENV_VAR}=true was set.`
    );
    return;
  }

  const result = verifyBaseUrlInBundle(directory, pathPrefix);
  if (result.ok) {
    return;
  }

  const normalized = '/' + pathPrefix.replace(/^\/+|\/+$/g, '');
  throw new Error(
    [
      `Preview deploy base URL check failed.`,
      ``,
      `Scanned ${result.scannedFiles} file(s) in ${directory} but found no references to "${pathPrefix}".`,
      `This almost always means the build was not configured with a base URL matching the preview path prefix,`,
      `and assets will 404 after deployment.`,
      ``,
      `Fix: rebuild with your framework's base URL set to "${normalized}/". Examples:`,
      `  - Vite:    vite build --base=${normalized}/`,
      `  - Next.js: set basePath: "${normalized}" in next.config.js`,
      `  - Angular: ng build --base-href=${normalized}/`,
      `  - Astro:   astro build --base=${normalized}`,
      ``,
      `Most CI workflows pass the prefix as an env var to the build step, e.g.`,
      `    PATH_PREFIX=${normalized} VITE_BASE_URL=$PATH_PREFIX/ nx build my-app`,
      ``,
      `To bypass this check (not recommended) set ${SKIP_ENV_VAR}=true.`,
    ].join('\n')
  );
}
