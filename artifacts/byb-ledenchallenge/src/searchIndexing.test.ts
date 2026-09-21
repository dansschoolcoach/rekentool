import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const indexHtml = readFileSync(
  new URL('../index.html', import.meta.url),
  'utf8',
);
const robotsTxt = readFileSync(
  new URL('../public/robots.txt', import.meta.url),
  'utf8',
);

describe('search engine indexing instructions', () => {
  it('marks the shared app document as noindex before JavaScript runs', () => {
    assert.match(
      indexHtml,
      /<meta\s+name=["']robots["']\s+content=["'][^"']*\bnoindex\b[^"']*["']\s*\/?>/i,
    );
    assert.doesNotMatch(
      indexHtml,
      /<meta\s+name=["']robots["']\s+content=["'][^"']*\bindex\b[^"']*["']\s*\/?>/i,
    );
  });

  it('lets crawlers read the document-level noindex instruction', () => {
    assert.match(robotsTxt, /^User-agent:\s*\*$/im);
    assert.match(robotsTxt, /^Allow:\s*\/$/im);
    assert.doesNotMatch(robotsTxt, /^Disallow:\s*\/$/im);
  });
});