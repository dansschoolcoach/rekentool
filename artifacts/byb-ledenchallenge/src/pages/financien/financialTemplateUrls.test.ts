import test from 'node:test';
import assert from 'node:assert/strict';
import { financialTemplateFilenames, getFinancialTemplateUrls } from './financialTemplateUrls.ts';

test('financial template downloads retain a non-root application base path', () => {
  assert.deepEqual(getFinancialTemplateUrls('/ledenchallenge/'), {
    teachers: `/ledenchallenge/templates/${financialTemplateFilenames.teachers}`,
    subscriptions: `/ledenchallenge/templates/${financialTemplateFilenames.subscriptions}`,
  });
});