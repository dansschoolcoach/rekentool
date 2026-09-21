import assert from 'node:assert/strict';
import test from 'node:test';
import { smokeBuiltIndexHtml } from './smoke-built-index-html.mjs';

const builtIndexUrl = new URL('file:///tmp/byb-built-index.html');

test('accepts built HTML with a noindex robots directive', async () => {
  await assert.doesNotReject(
    smokeBuiltIndexHtml({
      builtIndexUrl,
      readTextFile: async () =>
        '<html><head><meta content="noindex, nofollow" name="ROBOTS"></head></html>',
    }),
  );
});

test('rejects built HTML without a robots meta tag clearly', async () => {
  await assert.rejects(
    smokeBuiltIndexHtml({
      builtIndexUrl,
      readTextFile: async () => '<html><head></head></html>',
    }),
    /Built index HTML at .* is missing a robots meta tag with a noindex directive/,
  );
});

test('rejects built HTML whose robots metadata allows indexing', async () => {
  await assert.rejects(
    smokeBuiltIndexHtml({
      builtIndexUrl,
      readTextFile: async () =>
        '<html><head><meta name="robots" content="index, follow"></head></html>',
    }),
    /Built index HTML at .* has robots meta content "index, follow"; expected a noindex directive/,
  );
});

test('reports clearly when the built index cannot be read', async () => {
  const readError = new Error('file does not exist');
  await assert.rejects(
    smokeBuiltIndexHtml({
      builtIndexUrl,
      readTextFile: async () => {
        throw readError;
      },
    }),
    (error) => {
      assert.match(error.message, /Could not inspect the built index HTML at .*file does not exist/);
      assert.equal(error.cause, readError);
      return true;
    },
  );
});