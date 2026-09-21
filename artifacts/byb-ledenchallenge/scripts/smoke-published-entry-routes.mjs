import { chromium } from '@playwright/test';

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_AFTER_DELAY_MS = 30_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;
const MAX_DOCUMENT_REQUESTS = 6;
const CLERK_INVITATION_STATUS_PATTERN =
  /(invitation|uitnodiging|ticket).*(invalid|expired|no longer valid|not found|verlopen|ongeldig)|(invalid|expired|no longer valid|not found|verlopen|ongeldig).*(invitation|uitnodiging|ticket)/i;
const CLERK_INVITATION_STATUS_SELECTOR =
  '[data-localization-key*="invitation" i], [data-localization-key*="ticket" i]';
const CLERK_INVITATION_STATUS_KEY_PATTERN = /(invitation|ticket)/i;
const CLEANUP_PHASE = 'cleanup';
const CLEANUP_ERROR_CODES = Object.freeze({
  context: 'PUBLISHED_ENTRY_ROUTE_CONTEXT_CLEANUP_FAILED',
  browser: 'PUBLISHED_ENTRY_ROUTE_BROWSER_CLEANUP_FAILED',
});
const CLERK_TICKET_DIAGNOSTIC_PATTERN = /([?&#]__clerk_ticket=)[^&#\s"'`]*/gi;
const NON_DESTRUCTIVE_CLERK_TICKET_SEARCH =
  '?__clerk_ticket=published%2Bsmoke%2Fticket%3Dreserved%26value%25&__clerk_status=sign_up';
const NON_DESTRUCTIVE_CLERK_TICKET_HASH = '#clerk-invitation%2Fregistration';

function redactClerkTicket(value) {
  return String(value).replace(CLERK_TICKET_DIAGNOSTIC_PATTERN, '$1[redacted]');
}

function errorMessage(error) {
  return redactClerkTicket(error instanceof Error ? error.message : error);
}

async function retryDelayFromResponse(response, fallbackDelayMs) {
  let headers;
  try {
    headers = await response?.headersArray?.();
  } catch {
    return fallbackDelayMs;
  }

  const retryAfter = headers
    ?.find(({ name }) => name.toLowerCase() === 'retry-after')
    ?.value?.trim();
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

function redactErrorChain(error, seen = new Set()) {
  if (!(error instanceof Error) || seen.has(error)) {
    return;
  }

  seen.add(error);
  error.message = redactClerkTicket(error.message);
  redactErrorChain(error.cause, seen);
}

function createCleanupError({ resource, attempt, cause }) {
  const code = CLEANUP_ERROR_CODES[resource];
  const resourceName = resource === 'context' ? 'browser-context' : 'browser';
  const readableMessage =
    resource === 'context'
      ? `Failed to close the browser context while cleaning up attempt ${attempt}: ${errorMessage(cause)}`
      : `Failed to close the browser while cleaning up attempt ${attempt}: ${errorMessage(cause)}`;
  const error = new Error(
    `${readableMessage} [publication-smoke code=${code} phase=${CLEANUP_PHASE} resource=${resourceName} attempt=${attempt}]`,
    { cause },
  );

  error.code = code;
  error.phase = CLEANUP_PHASE;
  error.resource = resourceName;
  error.attempt = attempt;
  return error;
}

function requirePublicAppUrl(environment) {
  const value = environment.VITE_PUBLIC_APP_URL?.trim();
  if (!value) {
    throw new Error('VITE_PUBLIC_APP_URL is required for the published entry-route smokecheck.');
  }
  return new URL(value);
}

function pathBelowBase(publicAppUrl, suffix) {
  const basePath = publicAppUrl.pathname.replace(/\/+$/, '');
  return `${basePath}${suffix}` || '/';
}

export function assertEntryRoute({
  label,
  finalUrl,
  publicAppUrl,
  expectedPath,
  expectedSearch,
  expectedHash,
  documentRequests,
}) {
  const actualUrl = new URL(finalUrl);
  const safeLabel = redactClerkTicket(label);
  if (actualUrl.origin !== publicAppUrl.origin || actualUrl.pathname !== expectedPath) {
    throw new Error(
      `${safeLabel} ended at ${redactClerkTicket(actualUrl.href)}; expected ${redactClerkTicket(`${publicAppUrl.origin}${expectedPath}`)}.`,
    );
  }
  if (expectedSearch !== undefined && actualUrl.search !== expectedSearch) {
    throw new Error(
      `${safeLabel} ended with query "${redactClerkTicket(actualUrl.search)}"; expected "${redactClerkTicket(expectedSearch)}".`,
    );
  }
  if (expectedHash !== undefined && actualUrl.hash !== expectedHash) {
    throw new Error(
      `${safeLabel} ended with hash "${redactClerkTicket(actualUrl.hash)}"; expected "${redactClerkTicket(expectedHash)}".`,
    );
  }
  if (documentRequests > MAX_DOCUMENT_REQUESTS) {
    throw new Error(
      `${safeLabel} made ${documentRequests} document requests; expected at most ${MAX_DOCUMENT_REQUESTS}. This may be a redirect loop.`,
    );
  }
}

export function assertNoIndexRobotsMeta({ label, content }) {
  const safeLabel = redactClerkTicket(label);
  if (content === null) {
    throw new Error(`${safeLabel} is missing a robots meta tag with a noindex directive.`);
  }

  const directives = content
    .split(',')
    .map((directive) => directive.trim().toLowerCase())
    .filter(Boolean);
  if (!directives.includes('noindex')) {
    throw new Error(
      `${safeLabel} has robots meta content "${redactClerkTicket(content)}"; expected a noindex directive.`,
    );
  }
}

export function assertNoContradictoryXRobotsTag({ label, headerValues }) {
  const safeLabel = redactClerkTicket(label);
  for (const headerValue of headerValues) {
    const directives = headerValue
      .split(',')
      .map((directive) => directive.trim().toLowerCase())
      .filter(Boolean);

    for (const directive of directives) {
      const scopedDirective = directive.includes(':')
        ? directive.slice(directive.lastIndexOf(':') + 1).trim()
        : directive;
      if (scopedDirective === 'index') {
        throw new Error(
          `${safeLabel} has X-Robots-Tag header "${redactClerkTicket(headerValue)}" with an explicit index directive that contradicts noindex.`,
        );
      }
    }
  }
}

export function assertClerkInvitationStatus({ label, statusText, statusKey }) {
  const hasStableStatusKey = CLERK_INVITATION_STATUS_KEY_PATTERN.test(statusKey ?? '');
  if (!hasStableStatusKey && !CLERK_INVITATION_STATUS_PATTERN.test(statusText ?? '')) {
    throw new Error(
      `${redactClerkTicket(label)} did not show a visible invalid or expired Clerk invitation/ticket status; received "${redactClerkTicket(statusText ?? '')}".`,
    );
  }
}

export function robotsMetaContentFromHtml(html) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const metaTag of metaTags) {
    const attributes = new Map();
    for (const match of metaTag.matchAll(
      /([^\s"'=<>`]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
    )) {
      attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]);
    }

    if (attributes.get('name')?.toLowerCase() === 'robots') {
      return attributes.get('content') ?? null;
    }
  }

  return null;
}

async function verifyRoute({
  page,
  publicAppUrl,
  initialPath,
  expectedPath,
  expectedSearch,
  expectedHash,
  heading,
  invitationStatus,
  navigationTimeoutMs,
  onDocumentResponse,
}) {
  let documentRequests = 0;
  const documentResponses = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documentRequests += 1;
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      documentResponses.push(response);
      onDocumentResponse?.(response);
    }
  });

  const initialUrl = new URL(initialPath, publicAppUrl);
  await page.goto(initialUrl.href, {
    waitUntil: 'domcontentloaded',
    timeout: navigationTimeoutMs,
  });
  await page.getByRole('heading', { name: heading }).waitFor({
    state: 'visible',
    timeout: navigationTimeoutMs,
  });
  if (invitationStatus) {
    let status;
    let statusKey;
    try {
      status = page.locator(CLERK_INVITATION_STATUS_SELECTOR).first();
      await status.waitFor({
        state: 'visible',
        timeout: navigationTimeoutMs,
      });
      statusKey = await status.getAttribute('data-localization-key');
    } catch {
      status = page.getByText(CLERK_INVITATION_STATUS_PATTERN).first();
      try {
        await status.waitFor({
          state: 'visible',
          timeout: navigationTimeoutMs,
        });
      } catch (error) {
        throw new Error(
          `${redactClerkTicket(initialPath)} did not show a visible invalid or expired Clerk invitation/ticket status.`,
          { cause: error },
        );
      }
    }
    assertClerkInvitationStatus({
      label: redactClerkTicket(initialPath),
      statusText: await status.innerText(),
      statusKey,
    });
  }

  assertEntryRoute({
    label: initialPath,
    finalUrl: page.url(),
    publicAppUrl,
    expectedPath,
    expectedSearch,
    expectedHash,
    documentRequests,
  });
  const robotsContent = await page.locator('meta[name="robots"]').getAttribute('content');
  assertNoIndexRobotsMeta({
    label: redactClerkTicket(initialPath),
    content: robotsContent,
  });
  for (const documentResponse of documentResponses) {
    const headers = await documentResponse.headersArray();
    const xRobotsTagValues = headers
      .filter(({ name }) => name.toLowerCase() === 'x-robots-tag')
      .map(({ value }) => value);
    assertNoContradictoryXRobotsTag({
      label: redactClerkTicket(
        `${initialPath} (${documentResponse.status()} response from ${documentResponse.url()})`,
      ),
      headerValues: xRobotsTagValues,
    });
  }
  console.log(
    `Verified ${redactClerkTicket(initialUrl.href)} ends at ${redactClerkTicket(page.url())} without a redirect loop, includes a noindex robots directive, and has no contradictory X-Robots-Tag header.`,
  );
}

export async function smokePublishedEntryRoutes({
  environment = process.env,
  browserLauncher = chromium,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  navigationTimeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
} = {}) {
  const publicAppUrl = requirePublicAppUrl(environment);
  const signInPath = pathBelowBase(publicAppUrl, '/sign-in');
  const signUpPath = pathBelowBase(publicAppUrl, '/sign-up');
  const legacyInvitationUrl = new URL(
    `${pathBelowBase(publicAppUrl, '/sign-up/continue/verify')}${NON_DESTRUCTIVE_CLERK_TICKET_SEARCH}${NON_DESTRUCTIVE_CLERK_TICKET_HASH}`,
    publicAppUrl,
  );
  const legacyInvitationPath = `${legacyInvitationUrl.pathname}${legacyInvitationUrl.search}${legacyInvitationUrl.hash}`;
  const normalizedLegacySignUpPath = pathBelowBase(
    publicAppUrl,
    '/sign-up/continue/verify',
  );
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let browser;
    let context;
    let attemptError;
    let attemptSucceeded = false;
    let lastDocumentResponse;
    try {
      browser = await browserLauncher.launch({ headless: true });
      context = await browser.newContext();
      const page = await context.newPage();

      await verifyRoute({
        page,
        publicAppUrl,
        initialPath: publicAppUrl.pathname,
        expectedPath: signInPath,
        heading: 'Welkom terug',
        navigationTimeoutMs,
        onDocumentResponse: (response) => {
          lastDocumentResponse = response;
        },
      });
      await context.clearCookies();
      await verifyRoute({
        page,
        publicAppUrl,
        initialPath: signInPath,
        expectedPath: signInPath,
        heading: 'Welkom terug',
        navigationTimeoutMs,
        onDocumentResponse: (response) => {
          lastDocumentResponse = response;
        },
      });
      await context.clearCookies();
      await verifyRoute({
        page,
        publicAppUrl,
        initialPath: signUpPath,
        expectedPath: signUpPath,
        heading: 'Welkom bij de challenge',
        navigationTimeoutMs,
        onDocumentResponse: (response) => {
          lastDocumentResponse = response;
        },
      });
      await context.clearCookies();
      await verifyRoute({
        page,
        publicAppUrl,
        initialPath: legacyInvitationPath,
        expectedPath: normalizedLegacySignUpPath,
        expectedSearch: legacyInvitationUrl.search,
        expectedHash: legacyInvitationUrl.hash,
        heading: 'Welkom bij de challenge',
        invitationStatus: true,
        navigationTimeoutMs,
        onDocumentResponse: (response) => {
          lastDocumentResponse = response;
        },
      });

      attemptSucceeded = true;
    } catch (error) {
      attemptError = error;
      lastError = error;
    } finally {
      let cleanupError;
      try {
        await context?.close();
      } catch (error) {
        cleanupError = createCleanupError({
          resource: 'context',
          attempt,
          cause: error,
        });
      }
      try {
        await browser?.close();
      } catch (error) {
        cleanupError ??= createCleanupError({
          resource: 'browser',
          attempt,
          cause: error,
        });
      }

      if (cleanupError) {
        if (attemptError) {
          console.warn(
            `Failed to clean up attempt ${attempt} after a published entry-route failure: ${errorMessage(cleanupError)}`,
          );
        } else {
          attemptSucceeded = false;
          lastError = cleanupError;
        }
      }
    }

    if (attemptSucceeded) {
      return;
    }

    if (attempt < maxAttempts) {
      const delayMs = await retryDelayFromResponse(lastDocumentResponse, retryDelayMs);
      console.warn(
        `Attempt ${attempt}/${maxAttempts} failed for the published entry routes; retrying in ${delayMs}ms.`,
      );
      await sleep(delayMs);
    }
  }

  redactErrorChain(lastError);
  throw new Error(
    `Failed to verify the published entry routes after ${maxAttempts} attempts: ${errorMessage(lastError)}`,
    { cause: lastError },
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await smokePublishedEntryRoutes();
}