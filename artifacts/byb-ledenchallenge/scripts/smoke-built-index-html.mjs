import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  assertNoIndexRobotsMeta,
  robotsMetaContentFromHtml,
} from './smoke-published-entry-routes.mjs';

const DEFAULT_BUILT_INDEX_URL = new URL('../dist/public/index.html', import.meta.url);

export async function smokeBuiltIndexHtml({
  builtIndexUrl = DEFAULT_BUILT_INDEX_URL,
  readTextFile = (url) => readFile(url, 'utf8'),
} = {}) {
  const label = fileURLToPath(builtIndexUrl);
  let html;
  try {
    html = await readTextFile(builtIndexUrl);
  } catch (error) {
    throw new Error(`Could not inspect the built index HTML at ${label}: ${error.message}`, {
      cause: error,
    });
  }

  assertNoIndexRobotsMeta({
    label: `Built index HTML at ${label}`,
    content: robotsMetaContentFromHtml(html),
  });
  console.log(`Verified ${label} includes a robots meta tag with a noindex directive.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await smokeBuiltIndexHtml();
}