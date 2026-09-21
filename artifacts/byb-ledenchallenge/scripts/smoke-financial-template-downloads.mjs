import { financialTemplateFilenames, getFinancialTemplateUrls } from '../src/pages/financien/financialTemplateUrls.ts';
import { inflateRawSync } from 'node:zlib';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const REQUIRED_XLSX_ENTRIES = [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
];
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_AFTER_DELAY_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const SCHEDULE_METADATA_SHEET = '__ByBMetadata';
const SMOKE_SEASON_WITH_LOCATION = 'Release-smoke rooster met locatie';
const SMOKE_SEASON_WITHOUT_LOCATION = 'Release-smoke rooster zonder locatie';

function requireEnvironmentValue(name, environment) {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for the financial template smokecheck.`);
  }

  return value;
}

function assertXlsxBytes(bytes, filename) {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new Error(`${filename} is not a ZIP-based XLSX file.`);
  }

  const archiveText = new TextDecoder('latin1').decode(bytes);
  for (const entry of REQUIRED_XLSX_ENTRIES) {
    if (!archiveText.includes(entry)) {
      throw new Error(`${filename} is missing required XLSX entry "${entry}".`);
    }
  }
}

function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataStart = offset + 30 + nameLength + extraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (content) entries.set(name, decoder.decode(content));
    offset = dataStart + compressedSize;
  }
  return entries;
}

function assertScheduleWorkbook(bytes, expected) {
  assertXlsxBytes(bytes, 'roostersjabloon');
  const entries = zipEntries(bytes);
  const workbookXml = entries.get('xl/workbook.xml') ?? '';
  const rosterSheetXml = [...entries.entries()]
    .find(([name, xml]) => name.startsWith('xl/worksheets/sheet') && xml.includes('dataValidations'))?.[1] ?? '';
  const searchableContent = [...entries.values()].join('\n')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');

  for (const sheetName of ['Instructies', 'Rooster']) {
    if (!workbookXml.includes(`name="${sheetName}"`)) {
      throw new Error(`roostersjabloon is missing worksheet "${sheetName}".`);
    }
  }
  if (!workbookXml.includes(`name="${SCHEDULE_METADATA_SHEET}" state="veryHidden"`)) {
    throw new Error('roostersjabloon is missing very hidden control metadata.');
  }
  if (!rosterSheetXml.includes('dataValidation')) {
    throw new Error('roostersjabloon is missing roster choice validations.');
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!searchableContent.includes(`"${key}":${JSON.stringify(value)}`)) {
      throw new Error(`roostersjabloon metadata does not contain current ${key}.`);
    }
  }
}

async function apiRequest(url, token, fetchImplementation, requestTimeoutMs, options = {}) {
  return fetchImplementation(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
}

function retryDelayFromResponse(response, fallbackDelayMs) {
  const retryAfter = response?.headers.get('retry-after')?.trim();
  if (!retryAfter) return fallbackDelayMs;

  let delayMs;
  if (/^\d+$/.test(retryAfter)) {
    const delaySeconds = Number(retryAfter);
    if (Number.isSafeInteger(delaySeconds)) delayMs = delaySeconds * 1_000;
  } else {
    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) delayMs = Math.max(0, retryAt - Date.now());
  }

  if (!Number.isFinite(delayMs)) return fallbackDelayMs;
  return Math.min(delayMs, MAX_RETRY_AFTER_DELAY_MS);
}

async function retryingApiRequest({
  url,
  token,
  fetchImplementation,
  requestTimeoutMs,
  maxAttempts,
  retryDelayMs,
  sleep,
  options,
}) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await apiRequest(
        url,
        token,
        fetchImplementation,
        requestTimeoutMs,
        options,
      );
      if (response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts) {
      const delayMs = retryDelayFromResponse(response, retryDelayMs);
      console.warn(
        `Attempt ${attempt}/${maxAttempts} failed for ${url.href}; retrying in ${delayMs}ms.`,
      );
      await sleep(delayMs);
    }
  }

  throw new Error(
    `Request to ${url.href} failed after ${maxAttempts} attempts: ${lastError.message}`,
    { cause: lastError },
  );
}

function smokeSeasonBody(name, withLocation) {
  return {
    name,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    country: 'Nederland',
    hasStarterDeduction: false,
    defaultSalary: 0,
    teachers: [],
    locations: withLocation
      ? [{ clientId: 'release-smoke-location', name: 'Release-smoke locatie', rentFrequency: 'hour', rent: 0, rentTermCount: null, sessionMinutes: 60 }]
      : [],
    subscriptions: [],
    lessons: [],
    closures: [],
  };
}

async function selectOrCreateSmokeSeason({
  apiBaseUrl, participantId, token, name, withLocation, apiRequestWithRetry,
}) {
  const listUrl = new URL(`admin/financial/participants/${participantId}/seasons`, apiBaseUrl);
  const listResponse = await apiRequestWithRetry(listUrl);
  if (!listResponse.ok) throw new Error(`Season list returned HTTP ${listResponse.status}.`);
  const seasons = await listResponse.json();
  for (const season of seasons) {
    const detailUrl = new URL(`admin/financial/participants/${participantId}/seasons/${season.id}`, apiBaseUrl);
    const detailResponse = await apiRequestWithRetry(detailUrl);
    if (!detailResponse.ok) throw new Error(`Season ${season.id} returned HTTP ${detailResponse.status}.`);
    const detail = await detailResponse.json();
    if ((detail.locations.length > 0) === withLocation) return detail;
  }

  const createResponse = await apiRequestWithRetry(listUrl, {
    method: 'POST',
    body: JSON.stringify(smokeSeasonBody(name, withLocation)),
  });
  if (!createResponse.ok) throw new Error(`Creating smoke season "${name}" returned HTTP ${createResponse.status}.`);
  const created = await createResponse.json();
  const detailUrl = new URL(`admin/financial/participants/${participantId}/seasons/${created.id}`, apiBaseUrl);
  const detailResponse = await apiRequestWithRetry(detailUrl);
  if (!detailResponse.ok) throw new Error(`Created smoke season returned HTTP ${detailResponse.status}.`);
  return detailResponse.json();
}

async function smokeScheduleTemplateDownload({
  environment, publicAppUrl, fetchImplementation, requestTimeoutMs, maxAttempts, retryDelayMs, sleep,
}) {
  const token = requireEnvironmentValue('RELEASE_SMOKE_ADMIN_TOKEN', environment);
  const participantId = requireEnvironmentValue('RELEASE_SMOKE_PARTICIPANT_ID', environment);
  const apiBaseUrl = new URL('/api/', publicAppUrl);
  const apiRequestWithRetry = (url, options) => retryingApiRequest({
    url,
    token,
    fetchImplementation,
    requestTimeoutMs,
    maxAttempts,
    retryDelayMs,
    sleep,
    options,
  });
  const common = { apiBaseUrl, participantId, token, apiRequestWithRetry };
  const withLocation = await selectOrCreateSmokeSeason({
    ...common, name: SMOKE_SEASON_WITH_LOCATION, withLocation: true,
  });
  const withoutLocation = await selectOrCreateSmokeSeason({
    ...common, name: SMOKE_SEASON_WITHOUT_LOCATION, withLocation: false,
  });

  const templateUrl = new URL(`admin/financial/participants/${participantId}/seasons/${withLocation.id}/imports/schedule/template`, apiBaseUrl);
  const templateResponse = await apiRequestWithRetry(templateUrl, {
    headers: { accept: XLSX_CONTENT_TYPE },
  });
  if (!templateResponse.ok) throw new Error(`Schedule template returned HTTP ${templateResponse.status}.`);
  assertScheduleWorkbook(new Uint8Array(await templateResponse.arrayBuffer()), {
    participantId: Number(participantId),
    seasonId: withLocation.id,
    seasonName: withLocation.name,
    masterDataVersion: withLocation.updatedAt,
  });

  const blockedUrl = new URL(`admin/financial/participants/${participantId}/seasons/${withoutLocation.id}/imports/schedule/template`, apiBaseUrl);
  const blockedResponse = await apiRequestWithRetry(blockedUrl);
  if (blockedResponse.status !== 422) {
    throw new Error(`Locationless schedule template returned HTTP ${blockedResponse.status}; expected 422.`);
  }
  console.log(`Verified ${templateUrl.href} and blocked locationless season ${withoutLocation.id}`);
}

export async function smokeFinancialTemplateDownloads({
  environment = process.env,
  fetchImplementation = fetch,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) {
  const publicAppUrl = requireEnvironmentValue('VITE_PUBLIC_APP_URL', environment);
  const basePath = requireEnvironmentValue('BASE_PATH', environment);
  const templatePaths = getFinancialTemplateUrls(basePath);

  for (const [kind, templatePath] of Object.entries(templatePaths)) {
    const filename = financialTemplateFilenames[kind];
    const templateUrl = new URL(templatePath, publicAppUrl);
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await fetchImplementation(templateUrl, {
          headers: { accept: XLSX_CONTENT_TYPE },
          redirect: 'follow',
          signal: AbortSignal.timeout(requestTimeoutMs),
        });

        if (!response.ok) {
          throw new Error(
            `${filename} returned HTTP ${response.status} from ${templateUrl.href}.`,
          );
        }

        assertXlsxBytes(new Uint8Array(await response.arrayBuffer()), filename);
        console.log(`Verified ${templateUrl.href}`);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          const delayMs = retryDelayFromResponse(response, retryDelayMs);
          console.warn(
            `Attempt ${attempt}/${maxAttempts} failed for ${filename}; retrying in ${delayMs}ms.`,
          );
          await sleep(delayMs);
        }
      }
    }

    if (lastError) {
      throw new Error(
        `Failed to verify ${filename} after ${maxAttempts} attempts: ${lastError.message}`,
        { cause: lastError },
      );
    }
  }

  await smokeScheduleTemplateDownload({
    environment,
    publicAppUrl,
    fetchImplementation,
    requestTimeoutMs,
    maxAttempts,
    retryDelayMs,
    sleep,
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await smokeFinancialTemplateDownloads();
}