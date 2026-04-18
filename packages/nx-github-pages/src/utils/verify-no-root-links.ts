import type { Dirent } from 'fs';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { logger } from '@nx/devkit';

import { SKIP_ENV_VAR } from './verify-base-url';

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

export function findRootLinksMissingPrefix(
  directory: string,
  pathPrefix: string
): RootLinkOffense[] {
  const prefix = pathPrefix.replace(/^\/+|\/+$/g, '');
  if (!prefix) return [];

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
      // protocol-relative (`//cdn.example.com/...`) is not a root-path link
      if (value.startsWith('//')) continue;
      // already prefixed? `/pr/42` or `/pr/42/...`
      if (value === `/${prefix}` || value.startsWith(`/${prefix}/`)) continue;
      offenses.push({
        file: relative(directory, file) || file,
        attribute,
        url: value,
      });
    }
  }
  return offenses;
}

export function assertNoRootLinks(
  directory: string,
  pathPrefix: string
): void {
  if (process.env[SKIP_ENV_VAR] === 'true') {
    logger.warn(
      `Skipping root-link check because ${SKIP_ENV_VAR}=true was set.`
    );
    return;
  }

  const offenses = findRootLinksMissingPrefix(directory, pathPrefix);
  if (offenses.length === 0) return;

  const prefix = '/' + pathPrefix.replace(/^\/+|\/+$/g, '');
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
      `Preview deploy root-link check failed.`,
      ``,
      `Found ${offenses.length} link(s) in the build output that point at the site root ("/...")`,
      `instead of the preview path "${prefix}/". Those links will 404 once the preview is deployed`,
      `to a subdirectory.`,
      ``,
      `Examples:`,
      list + extra,
      ``,
      `Fix: rebuild with your framework's base URL set to "${prefix}/" so emitted links include the prefix.`,
      `To bypass this check (not recommended) set ${SKIP_ENV_VAR}=true.`,
    ].join('\n')
  );
}
