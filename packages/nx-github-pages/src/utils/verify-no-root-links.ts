import type { Dirent } from 'fs';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { logger } from '@nx/devkit';

export const SKIP_ENV_VAR = 'NX_GITHUB_PAGES_SKIP_BASE_URL_CHECK';

const MAX_FILES = 500;
const MAX_BYTES_PER_FILE = 10 * 1024 * 1024;
const MAX_REPORTED = 10;

function* walkHtml(dir: string): Generator<string> {
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
      yield* walkHtml(full);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.html') || lower.endsWith('.htm')) {
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

export interface RootLinkOffense {
  file: string;
  attribute: string;
  url: string;
}

// Matches href/src/action attributes across HTML. Values are captured
// verbatim and filtered in JS — regex alone can't express "starts with /
// but not //" cleanly enough to stay readable across flavors.
const LINK_ATTR_RE = /\b(href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

export function normalizeBasePath(basePath: string): string {
  // Collapse the base path to "/<…>" — no trailing slash. Comparisons use
  // `${base}/` or equal `${base}` so the comparison stays unambiguous.
  const trimmed = basePath.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '/';
}

function toBaseList(input: string | string[]): string[] {
  const arr = Array.isArray(input) ? input : [input];
  return Array.from(new Set(arr.map(normalizeBasePath))).filter((b) => b !== '/');
}

export function findRootLinksOutsideBase(
  directory: string,
  basePath: string | string[]
): RootLinkOffense[] {
  const bases = toBaseList(basePath);
  // A base of "/" means the site is served from the domain root; every
  // rooted link is by definition within it, so nothing to flag.
  if (bases.length === 0) return [];

  const offenses: RootLinkOffense[] = [];
  let scanned = 0;

  for (const file of walkHtml(directory)) {
    if (scanned >= MAX_FILES) break;
    scanned++;
    const content = readCapped(file);
    LINK_ATTR_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LINK_ATTR_RE.exec(content)) !== null) {
      const attribute = match[1].toLowerCase();
      const value = match[2] ?? match[3] ?? '';
      if (!value.startsWith('/')) continue;
      // protocol-relative (`//cdn.example.com/...`) is not a root-path link.
      if (value.startsWith('//')) continue;
      // Rooted and within any of the accepted bases — fine.
      const inBase = bases.some(
        (base) => value === base || value.startsWith(`${base}/`)
      );
      if (inBase) continue;
      offenses.push({
        file: relative(directory, file) || file,
        attribute,
        url: value,
      });
    }
  }
  return offenses;
}

export function assertNoRootLinksOutsideBase(
  directory: string,
  basePath: string | string[]
): void {
  if (process.env[SKIP_ENV_VAR] === 'true') {
    logger.warn(
      `Skipping preview base URL check because ${SKIP_ENV_VAR}=true was set.`
    );
    return;
  }

  const offenses = findRootLinksOutsideBase(directory, basePath);
  if (offenses.length === 0) return;

  const bases = toBaseList(basePath);
  const basesList = bases.map((b) => `"${b}/"`).join(' or ');
  const sample = offenses.slice(0, MAX_REPORTED);
  const list = sample
    .map((o) => `  - ${o.file}: ${o.attribute}="${o.url}"`)
    .join('\n');
  const extra =
    offenses.length > sample.length
      ? `\n  …and ${offenses.length - sample.length} more`
      : '';

  throw new Error(
    [
      `Preview deploy base URL check failed.`,
      ``,
      `Found ${offenses.length} link(s) in the build output that target the site root`,
      `instead of ${basesList}. Those links will 404 once the preview is deployed`,
      `to a subdirectory.`,
      ``,
      `Examples:`,
      list + extra,
      ``,
      `Fix: rebuild with your framework's base URL set to one of the accepted paths`,
      `so emitted links include the prefix. To bypass this check (not recommended) set`,
      `${SKIP_ENV_VAR}=true.`,
    ].join('\n')
  );
}
