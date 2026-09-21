import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';

import { financialTemplateFilenames } from '../src/pages/financien/financialTemplateUrls.ts';
import { smokeFinancialTemplateDownloads } from './smoke-financial-template-downloads.mjs';
import { buildScheduleImportTemplate } from '../../api-server/src/services/financialImport.ts';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const templateDirectory = new URL('../public/templates/', import.meta.url);
const smokeEnvironment = {
  RELEASE_SMOKE_ADMIN_TOKEN: 'test-token',
  RELEASE_SMOKE_PARTICIPANT_ID: '7',
};

async function scheduleTemplateBytes({
  seasonId = 11,
  seasonName = 'Release-smoke rooster met locatie',
  masterDataVersion = '2026-09-19T12:00:00.000Z',
} = {}) {
  return buildScheduleImportTemplate({
    participantId: 7,
    seasonId,
    seasonName,
    templateVersion: '1',
    masterDataVersion,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    teachers: [],
    locations: [{ id: 4, name: 'Release-smoke locatie' }],
  });
}

async function smokeFetch(request, options) {
  const url = new URL(request);
  if (url.pathname.includes('/templates/')) return fetch(request, options);
  assert.equal(options.headers.authorization, 'Bearer test-token');
  if (url.pathname.endsWith('/seasons')) {
    return Response.json([
      { id: 11, name: 'Release-smoke rooster met locatie' },
      { id: 12, name: 'Release-smoke rooster zonder locatie' },
    ]);
  }
  if (url.pathname.endsWith('/seasons/11')) {
    return Response.json({
      id: 11,
      name: 'Release-smoke rooster met locatie',
      updatedAt: '2026-09-19T12:00:00.000Z',
      locations: [{ id: 4, name: 'Release-smoke locatie' }],
    });
  }
  if (url.pathname.endsWith('/seasons/12')) {
    return Response.json({
      id: 12,
      name: 'Release-smoke rooster zonder locatie',
      updatedAt: '2026-09-19T12:00:00.000Z',
      locations: [],
    });
  }
  if (url.pathname.endsWith('/seasons/11/imports/schedule/template')) {
    return new Response(await scheduleTemplateBytes(), { headers: { 'content-type': XLSX_CONTENT_TYPE } });
  }
  if (url.pathname.endsWith('/seasons/12/imports/schedule/template')) {
    return Response.json({ error: 'Voeg eerst minimaal één locatie toe.' }, { status: 422 });
  }
  throw new Error(`Unexpected request ${url.href}`);
}

async function startTemplateServer(responseOverride) {
  const requestedPaths = [];
  const server = createServer(async (request, response) => {
    requestedPaths.push(request.url);

    if (responseOverride) {
      responseOverride(response);
      return;
    }

    const filename = decodeURIComponent(request.url.split('/').at(-1));
    response.writeHead(200, { 'content-type': XLSX_CONTENT_TYPE });
    response.end(await readFile(new URL(filename, templateDirectory)));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  return {
    origin: `http://127.0.0.1:${address.port}`,
    requestedPaths,
    close: () => new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    ),
  };
}

test('smokecheck downloads both valid templates below the configured base path', async (t) => {
  const fixtureServer = await startTemplateServer();
  t.after(fixtureServer.close);

  await smokeFinancialTemplateDownloads({
    environment: {
      VITE_PUBLIC_APP_URL: fixtureServer.origin,
      BASE_PATH: '/published/ledenchallenge/',
      ...smokeEnvironment,
    },
    fetchImplementation: smokeFetch,
  });

  assert.deepEqual(fixtureServer.requestedPaths, [
    `/published/ledenchallenge/templates/${financialTemplateFilenames.teachers}`,
    `/published/ledenchallenge/templates/${financialTemplateFilenames.subscriptions}`,
  ]);
});

test('smokecheck creates and uses missing seasons with and without a location', async (t) => {
  const fixtureServer = await startTemplateServer();
  t.after(fixtureServer.close);
  const createdBodies = [];
  const scheduleTemplateSeasonIds = [];
  const createdSeasons = new Map();
  let nextSeasonId = 21;

  await smokeFinancialTemplateDownloads({
    environment: {
      VITE_PUBLIC_APP_URL: fixtureServer.origin,
      BASE_PATH: '/published/ledenchallenge/',
      ...smokeEnvironment,
    },
    fetchImplementation: async (request, options = {}) => {
      const url = new URL(request);
      if (url.pathname.includes('/templates/')) return fetch(request, options);
      assert.equal(options.headers.authorization, 'Bearer test-token');

      if (url.pathname.endsWith('/seasons') && options.method !== 'POST') {
        return Response.json([]);
      }
      if (url.pathname.endsWith('/seasons') && options.method === 'POST') {
        const body = JSON.parse(options.body);
        const id = nextSeasonId++;
        createdBodies.push(body);
        createdSeasons.set(id, {
          id,
          name: body.name,
          updatedAt: '2026-09-20T12:00:00.000Z',
          locations: body.locations,
        });
        return Response.json({ id }, { status: 201 });
      }

      const detailMatch = url.pathname.match(/\/seasons\/(\d+)$/);
      if (detailMatch) {
        const season = createdSeasons.get(Number(detailMatch[1]));
        assert.ok(season, `Expected created season ${detailMatch[1]}`);
        return Response.json(season);
      }

      const templateMatch = url.pathname.match(/\/seasons\/(\d+)\/imports\/schedule\/template$/);
      if (templateMatch) {
        const seasonId = Number(templateMatch[1]);
        const season = createdSeasons.get(seasonId);
        assert.ok(season, `Expected template request for created season ${seasonId}`);
        scheduleTemplateSeasonIds.push(seasonId);
        if (season.locations.length === 0) {
          return Response.json({ error: 'Voeg eerst minimaal één locatie toe.' }, { status: 422 });
        }
        return new Response(await scheduleTemplateBytes({
          seasonId,
          seasonName: season.name,
          masterDataVersion: season.updatedAt,
        }), { headers: { 'content-type': XLSX_CONTENT_TYPE } });
      }

      throw new Error(`Unexpected request ${url.href}`);
    },
  });

  assert.equal(createdBodies.length, 2);
  assert.deepEqual(createdBodies.map(({ name, locations }) => ({
    name,
    locationCount: locations.length,
  })), [
    { name: 'Release-smoke rooster met locatie', locationCount: 1 },
    { name: 'Release-smoke rooster zonder locatie', locationCount: 0 },
  ]);
  assert.deepEqual(scheduleTemplateSeasonIds, [21, 22]);
});

test('smokecheck rejects an HTML fallback returned with a successful status', async (t) => {
  const fixtureServer = await startTemplateServer((response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>Fallback</title>');
  });
  t.after(fixtureServer.close);

  await assert.rejects(
    smokeFinancialTemplateDownloads({
      environment: {
        VITE_PUBLIC_APP_URL: fixtureServer.origin,
        BASE_PATH: '/published/',
        ...smokeEnvironment,
      },
      maxAttempts: 1,
    }),
    /is not a ZIP-based XLSX file/,
  );
});

test('smokecheck retries a template while a deployment is propagating', async () => {
  const templateBytes = await readFile(
    new URL(financialTemplateFilenames.teachers, templateDirectory),
  );
  let attempts = 0;
  const delays = [];

  await smokeFinancialTemplateDownloads({
    environment: {
      VITE_PUBLIC_APP_URL: 'https://ledenchallenge.example.nl',
      BASE_PATH: '/',
        ...smokeEnvironment,
    },
    fetchImplementation: async (request, options) => {
      attempts += 1;
      if (attempts === 1) {
        return new Response('not ready', { status: 503 });
      }
      if (attempts <= 3) return new Response(templateBytes, {
        headers: { 'content-type': XLSX_CONTENT_TYPE },
      });
      return smokeFetch(request, options);
    },
    retryDelayMs: 25,
    sleep: async (delayMs) => delays.push(delayMs),
  });

  assert.ok(attempts > 3);
  assert.deepEqual(delays, [25]);
});

test('smokecheck retries temporary network and server failures from the schedule API', async (t) => {
  const fixtureServer = await startTemplateServer();
  t.after(fixtureServer.close);
  const attemptsByPath = new Map();
  const delays = [];

  await smokeFinancialTemplateDownloads({
    environment: {
      VITE_PUBLIC_APP_URL: fixtureServer.origin,
      BASE_PATH: '/',
      ...smokeEnvironment,
    },
    fetchImplementation: async (request, options) => {
      const url = new URL(request);
      if (url.pathname.includes('/templates/')) return fetch(request, options);
      const attempts = (attemptsByPath.get(url.pathname) ?? 0) + 1;
      attemptsByPath.set(url.pathname, attempts);
      if (attempts === 1 && url.pathname.endsWith('/seasons')) {
        throw new TypeError('temporary network failure');
      }
      if (
        attempts === 1 &&
        url.pathname.endsWith('/seasons/11/imports/schedule/template')
      ) {
        return new Response('temporarily unavailable', { status: 503 });
      }
      return smokeFetch(request, options);
    },
    retryDelayMs: 25,
    sleep: async (delayMs) => delays.push(delayMs),
  });

  assert.equal(attemptsByPath.get('/api/admin/financial/participants/7/seasons'), 3);
  assert.equal(
    attemptsByPath.get('/api/admin/financial/participants/7/seasons/11/imports/schedule/template'),
    2,
  );
  assert.deepEqual(delays, [25, 25]);
});

test('smokecheck uses a valid Retry-After value for temporary schedule API failures', async (t) => {
  const fixtureServer = await startTemplateServer();
  t.after(fixtureServer.close);
  const delays = [];
  let seasonListAttempts = 0;

  await smokeFinancialTemplateDownloads({
    environment: {
      VITE_PUBLIC_APP_URL: fixtureServer.origin,
      BASE_PATH: '/',
      ...smokeEnvironment,
    },
    fetchImplementation: async (request, options) => {
      const url = new URL(request);
      if (url.pathname.includes('/templates/')) return fetch(request, options);
      if (url.pathname.endsWith('/seasons') && seasonListAttempts++ === 0) {
        return new Response('temporarily unavailable', {
          status: 503,
          headers: { 'retry-after': '7' },
        });
      }
      return smokeFetch(request, options);
    },
    retryDelayMs: 25,
    sleep: async (delayMs) => delays.push(delayMs),
  });

  assert.deepEqual(delays, [7_000]);
});

test('smokecheck caps a future HTTP-date Retry-After value', async (t) => {
  const fixtureServer = await startTemplateServer();
  t.after(fixtureServer.close);
  const delays = [];
  let seasonListAttempts = 0;
  const retryAt = new Date(Date.now() + 60 * 60 * 1_000).toUTCString();

  await smokeFinancialTemplateDownloads({
    environment: {
      VITE_PUBLIC_APP_URL: fixtureServer.origin,
      BASE_PATH: '/',
      ...smokeEnvironment,
    },
    fetchImplementation: async (request, options) => {
      const url = new URL(request);
      if (url.pathname.includes('/templates/')) return fetch(request, options);
      if (url.pathname.endsWith('/seasons') && seasonListAttempts++ === 0) {
        return new Response('temporarily unavailable', {
          status: 503,
          headers: { 'retry-after': retryAt },
        });
      }
      return smokeFetch(request, options);
    },
    retryDelayMs: 25,
    sleep: async (delayMs) => delays.push(delayMs),
  });

  assert.deepEqual(delays, [30_000]);
});

test('smokecheck retries immediately for an expired HTTP-date Retry-After value', async (t) => {
  const fixtureServer = await startTemplateServer();
  t.after(fixtureServer.close);
  const delays = [];
  let seasonListAttempts = 0;

  await smokeFinancialTemplateDownloads({
    environment: {
      VITE_PUBLIC_APP_URL: fixtureServer.origin,
      BASE_PATH: '/',
      ...smokeEnvironment,
    },
    fetchImplementation: async (request, options) => {
      const url = new URL(request);
      if (url.pathname.includes('/templates/')) return fetch(request, options);
      if (url.pathname.endsWith('/seasons') && seasonListAttempts++ === 0) {
        return new Response('temporarily unavailable', {
          status: 503,
          headers: { 'retry-after': 'Thu, 01 Jan 1970 00:00:00 GMT' },
        });
      }
      return smokeFetch(request, options);
    },
    retryDelayMs: 25,
    sleep: async (delayMs) => delays.push(delayMs),
  });

  assert.deepEqual(delays, [0]);
});

test('smokecheck falls back to the configured retry delay for missing or invalid Retry-After values', async (t) => {
  const retryAfterValues = [undefined, 'later'];

  for (const retryAfter of retryAfterValues) {
    const fixtureServer = await startTemplateServer();
    t.after(fixtureServer.close);
    const delays = [];
    let seasonListAttempts = 0;

    await smokeFinancialTemplateDownloads({
      environment: {
        VITE_PUBLIC_APP_URL: fixtureServer.origin,
        BASE_PATH: '/',
        ...smokeEnvironment,
      },
      fetchImplementation: async (request, options) => {
        const url = new URL(request);
        if (url.pathname.includes('/templates/')) return fetch(request, options);
        if (url.pathname.endsWith('/seasons') && seasonListAttempts++ === 0) {
          return new Response('temporarily unavailable', {
            status: 503,
            headers: retryAfter ? { 'retry-after': retryAfter } : {},
          });
        }
        return smokeFetch(request, options);
      },
      retryDelayMs: 25,
      sleep: async (delayMs) => delays.push(delayMs),
    });

    assert.deepEqual(delays, [25]);
  }
});

test('smokecheck caps an excessive Retry-After value', async (t) => {
  const fixtureServer = await startTemplateServer();
  t.after(fixtureServer.close);
  const delays = [];
  let seasonListAttempts = 0;

  await smokeFinancialTemplateDownloads({
    environment: {
      VITE_PUBLIC_APP_URL: fixtureServer.origin,
      BASE_PATH: '/',
      ...smokeEnvironment,
    },
    fetchImplementation: async (request, options) => {
      const url = new URL(request);
      if (url.pathname.includes('/templates/')) return fetch(request, options);
      if (url.pathname.endsWith('/seasons') && seasonListAttempts++ === 0) {
        return new Response('temporarily unavailable', {
          status: 503,
          headers: { 'retry-after': '86400' },
        });
      }
      return smokeFetch(request, options);
    },
    retryDelayMs: 25,
    sleep: async (delayMs) => delays.push(delayMs),
  });

  assert.deepEqual(delays, [30_000]);
});

test('smokecheck reports permanent season API errors without retrying', async (t) => {
  const fixtureServer = await startTemplateServer();
  t.after(fixtureServer.close);
  let seasonListAttempts = 0;
  const delays = [];

  await assert.rejects(
    smokeFinancialTemplateDownloads({
      environment: {
        VITE_PUBLIC_APP_URL: fixtureServer.origin,
        BASE_PATH: '/',
        ...smokeEnvironment,
      },
      fetchImplementation: async (request, options) => {
        const url = new URL(request);
        if (url.pathname.includes('/templates/')) return fetch(request, options);
        seasonListAttempts += 1;
        return Response.json({ error: 'not authorized' }, { status: 403 });
      },
      retryDelayMs: 25,
      sleep: async (delayMs) => delays.push(delayMs),
    }),
    /Season list returned HTTP 403/,
  );

  assert.equal(seasonListAttempts, 1);
  assert.deepEqual(delays, []);
});