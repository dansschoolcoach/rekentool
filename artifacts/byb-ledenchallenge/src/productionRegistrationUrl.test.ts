import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildProductionRegistrationUrl } from './productionRegistrationUrl.ts';

describe('buildProductionRegistrationUrl', () => {
  it('builds the sign-up URL from valid HTTPS origins', () => {
    assert.equal(
      buildProductionRegistrationUrl('https://ledenchallenge.example.nl'),
      'https://ledenchallenge.example.nl/sign-up',
    );
    assert.equal(
      buildProductionRegistrationUrl('https://ledenchallenge.example.nl/'),
      'https://ledenchallenge.example.nl/sign-up',
    );
    assert.equal(
      buildProductionRegistrationUrl('https://ledenchallenge.example.nl:8443'),
      'https://ledenchallenge.example.nl:8443/sign-up',
    );
  });

  it('rejects missing and malformed values', () => {
    assert.throws(
      () => buildProductionRegistrationUrl(undefined),
      /VITE_PUBLIC_APP_URL environment variable is required/,
    );
    assert.throws(
      () => buildProductionRegistrationUrl('not a URL'),
      /Expected an HTTPS production origin/,
    );
  });

  for (const invalidValue of [
    'http://ledenchallenge.example.nl',
    'https://user:password@ledenchallenge.example.nl',
    'https://ledenchallenge.example.nl/preview',
    'https://ledenchallenge.example.nl?campaign=spring',
    'https://ledenchallenge.example.nl#registration',
  ]) {
    it(`rejects non-origin value ${invalidValue}`, () => {
      assert.throws(
        () => buildProductionRegistrationUrl(invalidValue),
        /Expected an HTTPS origin without credentials, a path, query, or hash/,
      );
    });
  }
});