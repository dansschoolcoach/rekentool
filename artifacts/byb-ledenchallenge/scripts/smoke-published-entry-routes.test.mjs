import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertEntryRoute,
  assertClerkInvitationStatus,
  assertNoContradictoryXRobotsTag,
  assertNoIndexRobotsMeta,
  smokePublishedEntryRoutes,
} from './smoke-published-entry-routes.mjs';

const publicAppUrl = new URL('https://ledenchallenge.example.test/');
const legacySignUpPath = '/sign-up';
const encodedClerkTicketSearch =
  '?__clerk_ticket=published%2Bsmoke%2Fticket%3Dreserved%26value%25&__clerk_status=sign_up';
const encodedClerkTicketHash = '#clerk-invitation%2Fregistration';
const encodedLegacyInvitationUrl = `https://ledenchallenge.example.test${legacySignUpPath}/continue/verify${encodedClerkTicketSearch}${encodedClerkTicketHash}`;

function normalizeLegacyInvitationUrl(url) {
  const currentUrl = new URL(url);
  if (currentUrl.pathname === legacySignUpPath || currentUrl.pathname.startsWith(`${legacySignUpPath}/`)) {
    currentUrl.pathname = `/sign-up${currentUrl.pathname.slice(legacySignUpPath.length)}`;
  }
  return currentUrl.href;
}

function createSuccessfulBrowserLauncher({
  events,
  invitationStatusText = 'This invitation is invalid or has expired.',
  invitationStatusKey = 'unstable__errors__invalid_invitation',
  failInvitationStatusOnAttempts = new Set(),
  retryAfter,
  failFirstAttempt = false,
  onContextClose = async () => {},
  onBrowserClose = async () => {},
}) {
  let launchCount = 0;

  return {
    getLaunchCount: () => launchCount,
    browserLauncher: {
      async launch() {
        launchCount += 1;
        const attempt = launchCount;
        const mainFrame = {};
        let currentUrl = publicAppUrl.href;
        const listeners = new Map();
        const page = {
          on(eventName, listener) {
            listeners.set(eventName, listener);
          },
          mainFrame() {
            return mainFrame;
          },
          async goto(url) {
            currentUrl = url;
            const request = {
              isNavigationRequest: () => true,
              frame: () => mainFrame,
            };
            listeners.get('request')?.(request);
            listeners.get('response')?.({
              request: () => request,
              status: () => 200,
              url: () => url,
              async headersArray() {
                return [
                  { name: 'X-Robots-Tag', value: 'noindex, nofollow' },
                  ...(retryAfter === undefined
                    ? []
                    : [{ name: 'Retry-After', value: retryAfter }]),
                ];
              },
            });
          },
          getByRole(role, options) {
            return {
              async waitFor() {
                if (failFirstAttempt && attempt === 1) {
                  throw new Error('temporary publication delay');
                }
                currentUrl =
                  options.name === 'Welkom terug'
                    ? 'https://ledenchallenge.example.test/sign-in'
                    : normalizeLegacyInvitationUrl(currentUrl);
              },
            };
          },
          getByText() {
            return {
              first() {
                return {
                  async waitFor() {
                    if (failInvitationStatusOnAttempts.has(attempt)) {
                      throw new Error('temporary Clerk invitation status failure');
                    }
                  },
                  async innerText() {
                    return invitationStatusText;
                  },
                };
              },
            };
          },
          url() {
            return currentUrl;
          },
          locator(selector) {
            if (selector.includes('data-localization-key')) {
              return {
                first() {
                  return {
                    async waitFor() {
                      if (
                        invitationStatusKey === null ||
                        failInvitationStatusOnAttempts.has(attempt)
                      ) {
                        throw new Error('invitation status is missing');
                      }
                    },
                    async getAttribute(attribute) {
                      return attribute === 'data-localization-key'
                        ? invitationStatusKey
                        : null;
                    },
                    async innerText() {
                      return invitationStatusText;
                    },
                  };
                },
              };
            }
            return {
              async getAttribute() {
                return 'noindex, nofollow';
              },
            };
          },
        };
        const context = {
          async newPage() {
            return page;
          },
          async clearCookies() {},
          async close() {
            events.push(['context.close', attempt]);
            await onContextClose(attempt);
          },
        };

        return {
          async newContext() {
            return context;
          },
          async close() {
            events.push(['browser.close', attempt]);
            await onBrowserClose(attempt);
          },
        };
      },
    },
  };
}

test('accepts the expected route with a bounded navigation count', () => {
  assert.doesNotThrow(() =>
    assertEntryRoute({
      label: 'home',
      finalUrl: 'https://ledenchallenge.example.test/sign-in',
      publicAppUrl,
      expectedPath: '/sign-in',
      documentRequests: 2,
    }),
  );
});

test('rejects a wrong final route', () => {
  assert.throws(
    () =>
      assertEntryRoute({
        label: 'home',
        finalUrl: 'https://ledenchallenge.example.test/',
        publicAppUrl,
        expectedPath: '/sign-in',
        documentRequests: 1,
      }),
    /expected .*\/sign-in/,
  );
});

test('accepts a legacy invitation route with an encoded Clerk ticket and hash', () => {
  assert.doesNotThrow(() =>
    assertEntryRoute({
      label: 'legacy invitation',
      finalUrl: encodedLegacyInvitationUrl.replace(legacySignUpPath, '/sign-up'),
      publicAppUrl,
      expectedPath: '/sign-up/continue/verify',
      expectedSearch: encodedClerkTicketSearch,
      expectedHash: encodedClerkTicketHash,
      documentRequests: 2,
    }),
  );
});

test('rejects a legacy invitation route when the encoded Clerk ticket is lost', () => {
  let error;
  assert.throws(
    () =>
      assertEntryRoute({
        label: 'legacy invitation',
        finalUrl: 'https://ledenchallenge.example.test/sign-up/continue/verify',
        publicAppUrl,
        expectedPath: '/sign-up/continue/verify',
        expectedSearch: encodedClerkTicketSearch,
        expectedHash: encodedClerkTicketHash,
        documentRequests: 2,
      }),
    (caughtError) => {
      error = caughtError;
      return true;
    },
  );
  assert.match(
    error.message,
    /legacy invitation ended with query ""; expected "\?__clerk_ticket=\[redacted\]&__clerk_status=sign_up"/,
  );
  assert.doesNotMatch(error.message, /published%2Bsmoke%2Fticket%3Dreserved%26value%25/);
});

test('rejects a legacy invitation route when the encoded Clerk ticket is changed', () => {
  let error;
  assert.throws(
    () =>
      assertEntryRoute({
        label: 'legacy invitation',
        finalUrl:
          'https://ledenchallenge.example.test/sign-up/continue/verify?__clerk_ticket=published%2Bsmoke%2Fticket%3Dchanged%26value%25&__clerk_status=sign_up#clerk-invitation%2Fregistration',
        publicAppUrl,
        expectedPath: '/sign-up/continue/verify',
        expectedSearch: encodedClerkTicketSearch,
        expectedHash: encodedClerkTicketHash,
        documentRequests: 2,
      }),
    (caughtError) => {
      error = caughtError;
      return true;
    },
  );
  assert.match(error.message, /legacy invitation ended with query .*expected/);
  assert.doesNotMatch(error.message, /published%2Bsmoke%2Fticket%3D(?:reserved|changed)%26value%25/);
});

test('accepts a visible invalid Clerk invitation status without consuming a real invitation', () => {
  assert.doesNotThrow(() =>
    assertClerkInvitationStatus({
      label: 'legacy invitation',
      statusText: 'This invitation is invalid or has expired.',
    }),
  );
});

test('accepts a Dutch invalid Clerk invitation status', () => {
  assert.doesNotThrow(() =>
    assertClerkInvitationStatus({
      label: 'legacy invitation',
      statusText: 'Deze uitnodiging is ongeldig of verlopen.',
    }),
  );
});

test('accepts a changed Clerk invitation message when its stable status key remains present', () => {
  assert.doesNotThrow(() =>
    assertClerkInvitationStatus({
      label: 'legacy invitation',
      statusText: 'This link can no longer be used.',
      statusKey: 'unstable__errors__invalid_invitation',
    }),
  );
});

test('rejects a Clerk registration page without an invitation status', () => {
  assert.throws(
    () =>
      assertClerkInvitationStatus({
        label: 'legacy invitation',
        statusText: 'Welkom bij de challenge',
      }),
    /did not show a visible invalid or expired Clerk invitation\/ticket status/,
  );
});

test('fails the published route check when Clerk does not show an invitation status', async () => {
  const { browserLauncher } = createSuccessfulBrowserLauncher({
    events: [],
    invitationStatusText: 'Welkom bij de challenge',
    invitationStatusKey: null,
  });

  let error;
  await assert.rejects(
    smokePublishedEntryRoutes({
      environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
      browserLauncher,
      maxAttempts: 1,
    }),
    (caughtError) => {
      error = caughtError;
      return true;
    },
  );
  assert.match(
    error.message,
    /\/sign-up\/continue\/verify\?__clerk_ticket=\[redacted\]&__clerk_status=sign_up#clerk-invitation%2Fregistration did not show a visible invalid or expired Clerk invitation\/ticket status/,
  );
  assert.doesNotMatch(error.message, /published%2Bsmoke%2Fticket%3Dreserved%26value%25/);
});

test('retries after a temporary Clerk invitation status failure and cleans up each attempt once', async () => {
  const events = [];
  const { browserLauncher, getLaunchCount } = createSuccessfulBrowserLauncher({
    events,
    failInvitationStatusOnAttempts: new Set([1]),
  });

  await smokePublishedEntryRoutes({
    environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
    browserLauncher,
    maxAttempts: 2,
    retryDelayMs: 25,
    sleep: async (delayMs) => events.push(['sleep', delayMs]),
  });

  assert.equal(getLaunchCount(), 2);
  assert.deepEqual(
    events.filter(([event]) => event === 'sleep'),
    [['sleep', 25]],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'context.close'),
    [
      ['context.close', 1],
      ['context.close', 2],
    ],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'browser.close'),
    [
      ['browser.close', 1],
      ['browser.close', 2],
    ],
  );
  assert.ok(
    events.findIndex(([event, attempt]) => event === 'context.close' && attempt === 1) <
      events.findIndex(([event]) => event === 'sleep'),
  );
});

test('preserves the final Clerk invitation status failure after all retries and cleans up each attempt once', async () => {
  const events = [];
  const { browserLauncher, getLaunchCount } = createSuccessfulBrowserLauncher({
    events,
    failInvitationStatusOnAttempts: new Set([1, 2]),
  });

  await assert.rejects(
    smokePublishedEntryRoutes({
      environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
      browserLauncher,
      maxAttempts: 2,
      retryDelayMs: 25,
      sleep: async (delayMs) => events.push(['sleep', delayMs]),
    }),
    (error) => {
      assert.match(
        error.message,
        /Failed to verify the published entry routes after 2 attempts: .*did not show a visible invalid or expired Clerk invitation\/ticket status/,
      );
      assert.match(error.cause.cause.message, /temporary Clerk invitation status failure/);
      return true;
    },
  );

  assert.equal(getLaunchCount(), 2);
  assert.deepEqual(
    events.filter(([event]) => event === 'sleep'),
    [['sleep', 25]],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'context.close'),
    [
      ['context.close', 1],
      ['context.close', 2],
    ],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'browser.close'),
    [
      ['browser.close', 1],
      ['browser.close', 2],
    ],
  );
});

test('masks the encoded Clerk ticket in successful route diagnostics', async () => {
  const messages = [];
  const originalConsoleLog = console.log;
  const { browserLauncher } = createSuccessfulBrowserLauncher({ events: [] });
  console.log = (message) => messages.push(message);

  try {
    await smokePublishedEntryRoutes({
      environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
      browserLauncher,
      maxAttempts: 1,
    });
  } finally {
    console.log = originalConsoleLog;
  }

  assert.ok(messages.length > 0);
  assert.ok(messages.every((message) => !message.includes('published%2Bsmoke%2Fticket%3Dreserved%26value%25')));
  assert.ok(messages.some((message) => message.includes('__clerk_ticket=[redacted]')));
});

test('masks the encoded Clerk ticket in browser failure causes', async () => {
  const rawTicket = 'published%2Bsmoke%2Fticket%3Dreserved%26value%25';
  let error;
  await assert.rejects(
    smokePublishedEntryRoutes({
      environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
      browserLauncher: {
        async launch() {
          throw new Error(
            `Navigation failed at https://ledenchallenge.example.test/sign-up/continue/verify?__clerk_ticket=${rawTicket}&__clerk_status=sign_up`,
          );
        },
      },
      maxAttempts: 1,
    }),
    (caughtError) => {
      error = caughtError;
      return true;
    },
  );

  assert.doesNotMatch(error.message, new RegExp(rawTicket));
  assert.doesNotMatch(error.cause.message, new RegExp(rawTicket));
  assert.match(error.cause.message, /__clerk_ticket=\[redacted\]/);
});

test('rejects excessive document requests as a possible redirect loop', () => {
  assert.throws(
    () =>
      assertEntryRoute({
        label: 'home',
        finalUrl: 'https://ledenchallenge.example.test/sign-in',
        publicAppUrl,
        expectedPath: '/sign-in',
        documentRequests: 7,
      }),
    /redirect loop/,
  );
});

test('accepts a robots meta tag containing a noindex directive', () => {
  assert.doesNotThrow(() =>
    assertNoIndexRobotsMeta({
      label: '/sign-in',
      content: 'NOINDEX, nofollow, noarchive',
    }),
  );
});

test('rejects a missing robots meta tag clearly', () => {
  assert.throws(
    () =>
      assertNoIndexRobotsMeta({
        label: '/sign-in',
        content: null,
      }),
    /\/sign-in is missing a robots meta tag with a noindex directive/,
  );
});

test('rejects robots meta content without a noindex directive clearly', () => {
  assert.throws(
    () =>
      assertNoIndexRobotsMeta({
        label: '/sign-up',
        content: 'index, follow',
      }),
    /\/sign-up has robots meta content "index, follow"; expected a noindex directive/,
  );
});

test('accepts absent and non-contradictory X-Robots-Tag headers', () => {
  assert.doesNotThrow(() =>
    assertNoContradictoryXRobotsTag({
      label: '/sign-in',
      headerValues: [],
    }),
  );
  assert.doesNotThrow(() =>
    assertNoContradictoryXRobotsTag({
      label: '/sign-in',
      headerValues: ['noindex, nofollow', 'googlebot: noindex'],
    }),
  );
});

test('rejects an explicit index directive in any X-Robots-Tag header clearly', () => {
  assert.throws(
    () =>
      assertNoContradictoryXRobotsTag({
        label: '/sign-up',
        headerValues: ['noarchive', 'googlebot: index, follow'],
      }),
    /\/sign-up has X-Robots-Tag header "googlebot: index, follow" with an explicit index directive that contradicts noindex/,
  );
});

test('rejects an explicit index directive from a document redirect clearly', async () => {
  const mainFrame = {};
  const listeners = new Map();
  let currentUrl = publicAppUrl.href;
  const page = {
    on(eventName, listener) {
      listeners.set(eventName, listener);
    },
    mainFrame: () => mainFrame,
    async goto(url) {
      const request = {
        isNavigationRequest: () => true,
        frame: () => mainFrame,
      };
      listeners.get('request')?.(request);
      listeners.get('response')?.({
        request: () => request,
        status: () => 302,
        url: () => url,
        headersArray: async () => [{ name: 'X-Robots-Tag', value: 'index, follow' }],
      });
      listeners.get('response')?.({
        request: () => request,
        status: () => 200,
        url: () => `${url}sign-in`,
        headersArray: async () => [{ name: 'X-Robots-Tag', value: 'noindex' }],
      });
    },
    getByRole() {
      return {
        async waitFor() {
          currentUrl = 'https://ledenchallenge.example.test/sign-in';
        },
      };
    },
    url: () => currentUrl,
    locator() {
      return { getAttribute: async () => 'noindex, nofollow' };
    },
  };
  const browserLauncher = {
    async launch() {
      return {
        async newContext() {
          return {
            newPage: async () => page,
            clearCookies: async () => {},
            close: async () => {},
          };
        },
        close: async () => {},
      };
    },
  };

  await assert.rejects(
    smokePublishedEntryRoutes({
      environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
      browserLauncher,
      maxAttempts: 1,
    }),
    /\/ \(302 response from https:\/\/ledenchallenge\.example\.test\/\) has X-Robots-Tag header "index, follow"/,
  );
});

test('fails clearly when the public URL is missing', async () => {
  await assert.rejects(
    smokePublishedEntryRoutes({ environment: {} }),
    /VITE_PUBLIC_APP_URL is required/,
  );
});

test('retries a successful route check when context cleanup fails', async () => {
  const events = [];
  const cleanupError = new Error('temporary context cleanup failure');
  const { browserLauncher, getLaunchCount } = createSuccessfulBrowserLauncher({
    events,
    onContextClose: async (attempt) => {
      if (attempt === 1) {
        throw cleanupError;
      }
    },
  });

  await smokePublishedEntryRoutes({
    environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
    browserLauncher,
    maxAttempts: 2,
    retryDelayMs: 25,
    sleep: async (delayMs) => events.push(['sleep', delayMs]),
  });

  assert.equal(getLaunchCount(), 2);
  assert.deepEqual(
    events.filter(([event]) => event === 'sleep'),
    [['sleep', 25]],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'context.close'),
    [
      ['context.close', 1],
      ['context.close', 2],
    ],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'browser.close'),
    [
      ['browser.close', 1],
      ['browser.close', 2],
    ],
  );
});

test('reports a persistent browser cleanup failure after exhausting retries', async () => {
  const events = [];
  const cleanupError = new Error('browser cleanup failed permanently');
  const { browserLauncher, getLaunchCount } = createSuccessfulBrowserLauncher({
    events,
    onBrowserClose: async () => {
      throw cleanupError;
    },
  });

  await assert.rejects(
    smokePublishedEntryRoutes({
      environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
      browserLauncher,
      maxAttempts: 2,
      retryDelayMs: 25,
      sleep: async (delayMs) => events.push(['sleep', delayMs]),
    }),
    (error) => {
      assert.match(
        error.message,
        /Failed to verify the published entry routes after 2 attempts: Failed to close the browser while cleaning up attempt 2: browser cleanup failed permanently \[publication-smoke code=PUBLISHED_ENTRY_ROUTE_BROWSER_CLEANUP_FAILED phase=cleanup resource=browser attempt=2\]/,
      );
      assert.equal(error.cause.cause, cleanupError);
      assert.equal(error.cause.code, 'PUBLISHED_ENTRY_ROUTE_BROWSER_CLEANUP_FAILED');
      assert.equal(error.cause.phase, 'cleanup');
      assert.equal(error.cause.resource, 'browser');
      assert.equal(error.cause.attempt, 2);
      return true;
    },
  );

  assert.equal(getLaunchCount(), 2);
  assert.deepEqual(
    events.filter(([event]) => event === 'sleep'),
    [['sleep', 25]],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'context.close'),
    [
      ['context.close', 1],
      ['context.close', 2],
    ],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'browser.close'),
    [
      ['browser.close', 1],
      ['browser.close', 2],
    ],
  );
});

test('reports a persistent browser context cleanup failure after exhausting retries', async () => {
  const events = [];
  const cleanupError = new Error('browser context cleanup failed permanently');
  const { browserLauncher, getLaunchCount } = createSuccessfulBrowserLauncher({
    events,
    onContextClose: async () => {
      throw cleanupError;
    },
  });

  await assert.rejects(
    smokePublishedEntryRoutes({
      environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
      browserLauncher,
      maxAttempts: 2,
      retryDelayMs: 25,
      sleep: async (delayMs) => events.push(['sleep', delayMs]),
    }),
    (error) => {
      assert.match(
        error.message,
        /Failed to verify the published entry routes after 2 attempts: Failed to close the browser context while cleaning up attempt 2: browser context cleanup failed permanently \[publication-smoke code=PUBLISHED_ENTRY_ROUTE_CONTEXT_CLEANUP_FAILED phase=cleanup resource=browser-context attempt=2\]/,
      );
      assert.equal(error.cause.cause, cleanupError);
      assert.equal(error.cause.code, 'PUBLISHED_ENTRY_ROUTE_CONTEXT_CLEANUP_FAILED');
      assert.equal(error.cause.phase, 'cleanup');
      assert.equal(error.cause.resource, 'browser-context');
      assert.equal(error.cause.attempt, 2);
      return true;
    },
  );

  assert.equal(getLaunchCount(), 2);
  assert.deepEqual(
    events.filter(([event]) => event === 'sleep'),
    [['sleep', 25]],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'context.close'),
    [
      ['context.close', 1],
      ['context.close', 2],
    ],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'browser.close'),
    [
      ['browser.close', 1],
      ['browser.close', 2],
    ],
  );
});

test('reports the first cleanup failure when both context and browser cleanup fail', async () => {
  const events = [];
  const contextCleanupError = new Error('context cleanup failed first');
  const browserCleanupError = new Error('browser cleanup failed second');
  const { browserLauncher } = createSuccessfulBrowserLauncher({
    events,
    onContextClose: async () => {
      throw contextCleanupError;
    },
    onBrowserClose: async () => {
      throw browserCleanupError;
    },
  });

  await assert.rejects(
    smokePublishedEntryRoutes({
      environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
      browserLauncher,
      maxAttempts: 1,
    }),
    (error) => {
      assert.match(
        error.message,
        /Failed to verify the published entry routes after 1 attempts: Failed to close the browser context while cleaning up attempt 1: context cleanup failed first/,
      );
      assert.equal(error.cause.cause, contextCleanupError);
      assert.notEqual(error.cause.cause, browserCleanupError);
      return true;
    },
  );

  assert.deepEqual(events, [
    ['context.close', 1],
    ['browser.close', 1],
  ]);
});

test('retries after a temporary browser launch failure and only cleans up the successful attempt', async () => {
  const events = [];
  const launchError = new Error('temporary browser launch failure');
  const successfulLauncher = createSuccessfulBrowserLauncher({ events });
  let launchCount = 0;

  const browserLauncher = {
    async launch(options) {
      launchCount += 1;
      events.push(['launch', launchCount, options]);
      if (launchCount === 1) {
        throw launchError;
      }
      return successfulLauncher.browserLauncher.launch(options);
    },
  };

  await smokePublishedEntryRoutes({
    environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
    browserLauncher,
    maxAttempts: 2,
    retryDelayMs: 25,
    sleep: async (delayMs) => events.push(['sleep', delayMs]),
  });

  assert.equal(launchCount, 2);
  assert.deepEqual(
    events.filter(([event]) => event === 'sleep'),
    [['sleep', 25]],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'context.close'),
    [['context.close', 1]],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'browser.close'),
    [['browser.close', 1]],
  );
});

test('reports the last browser launch failure without closing uncreated resources', async () => {
  const events = [];
  const launchErrors = [
    new Error('first browser launch failure'),
    new Error('last browser launch failure'),
  ];
  let launchCount = 0;

  const browserLauncher = {
    async launch() {
      const error = launchErrors[launchCount];
      launchCount += 1;
      throw error;
    },
  };

  await assert.rejects(
    smokePublishedEntryRoutes({
      environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
      browserLauncher,
      maxAttempts: launchErrors.length,
      retryDelayMs: 25,
      sleep: async (delayMs) => events.push(['sleep', delayMs]),
    }),
    (error) => {
      assert.match(
        error.message,
        /Failed to verify the published entry routes after 2 attempts: last browser launch failure/,
      );
      assert.equal(error.cause, launchErrors[1]);
      return true;
    },
  );

  assert.equal(launchCount, 2);
  assert.deepEqual(events, [['sleep', 25]]);
});

test('uses a valid Retry-After value from a temporary route response', async () => {
  const events = [];
  const { browserLauncher } = createSuccessfulBrowserLauncher({
    events,
    retryAfter: '7',
    failFirstAttempt: true,
  });

  await smokePublishedEntryRoutes({
    environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
    browserLauncher,
    maxAttempts: 2,
    retryDelayMs: 25,
    sleep: async (delayMs) => events.push(['sleep', delayMs]),
  });

  assert.deepEqual(
    events.filter(([event]) => event === 'sleep'),
    [['sleep', 7_000]],
  );
});

test('falls back to the configured retry delay when Retry-After is missing or invalid', async () => {
  for (const retryAfter of [undefined, 'later']) {
    const events = [];
    const { browserLauncher } = createSuccessfulBrowserLauncher({
      events,
      retryAfter,
      failFirstAttempt: true,
    });

    await smokePublishedEntryRoutes({
      environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
      browserLauncher,
      maxAttempts: 2,
      retryDelayMs: 25,
      sleep: async (delayMs) => events.push(['sleep', delayMs]),
    });

    assert.deepEqual(
      events.filter(([event]) => event === 'sleep'),
      [['sleep', 25]],
      `unexpected retry delay for Retry-After=${retryAfter ?? '<missing>'}`,
    );
  }
});

test('caps an excessive Retry-After value for a temporary route response', async () => {
  const events = [];
  const { browserLauncher } = createSuccessfulBrowserLauncher({
    events,
    retryAfter: '86400',
    failFirstAttempt: true,
  });

  await smokePublishedEntryRoutes({
    environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
    browserLauncher,
    maxAttempts: 2,
    retryDelayMs: 25,
    sleep: async (delayMs) => events.push(['sleep', delayMs]),
  });

  assert.deepEqual(
    events.filter(([event]) => event === 'sleep'),
    [['sleep', 30_000]],
  );
});

test('retries a temporary browser failure and always closes contexts and browsers', async () => {
  const events = [];
  let launchCount = 0;

  const browserLauncher = {
    async launch(options) {
      launchCount += 1;
      const attempt = launchCount;
      events.push(['launch', attempt, options]);

      const mainFrame = {};
      let currentUrl = publicAppUrl.href;
      const listeners = new Map();
      const page = {
        on(eventName, listener) {
          events.push(['on', attempt, eventName]);
          listeners.set(eventName, listener);
        },
        mainFrame() {
          return mainFrame;
        },
        async goto(url, options) {
          currentUrl = url;
          events.push(['goto', attempt, url, options]);
          const request = {
            isNavigationRequest: () => true,
            frame: () => mainFrame,
          };
          listeners.get('request')?.(request);
          listeners.get('response')?.({
            request: () => request,
            status: () => 200,
            url: () => url,
            async headersArray() {
              events.push(['headersArray', attempt, url]);
              return [{ name: 'X-Robots-Tag', value: 'noindex, nofollow' }];
            },
          });
        },
        getByRole(role, options) {
          events.push(['heading', attempt, role, options.name]);
          return {
            async waitFor(waitOptions) {
              events.push(['waitFor', attempt, options.name, waitOptions]);
              if (attempt === 1) {
                throw new Error('temporary publication delay');
              }
              currentUrl =
                options.name === 'Welkom terug'
                  ? 'https://ledenchallenge.example.test/sign-in'
                  : normalizeLegacyInvitationUrl(currentUrl);
            },
          };
        },
        getByText() {
          return {
            first() {
              return {
                async waitFor() {},
                async innerText() {
                  return 'This invitation is invalid or has expired.';
                },
              };
            },
          };
        },
        url() {
          return currentUrl;
        },
        locator(selector) {
          events.push(['locator', attempt, selector]);
          return {
            async getAttribute(attribute) {
              events.push(['getAttribute', attempt, selector, attribute]);
              return 'noindex, nofollow, noarchive';
            },
          };
        },
      };

      const context = {
        async newPage() {
          events.push(['newPage', attempt]);
          return page;
        },
        async clearCookies() {
          events.push(['clearCookies', attempt]);
        },
        async close() {
          events.push(['context.close', attempt]);
        },
      };

      return {
        async newContext() {
          events.push(['newContext', attempt]);
          return context;
        },
        async close() {
          events.push(['browser.close', attempt]);
        },
      };
    },
  };

  await smokePublishedEntryRoutes({
    environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
    browserLauncher,
    maxAttempts: 2,
    retryDelayMs: 25,
    navigationTimeoutMs: 50,
    sleep: async (delayMs) => events.push(['sleep', delayMs]),
  });

  assert.equal(launchCount, 2);
  assert.deepEqual(
    events.filter(([event]) => event === 'goto').map(([, attempt, url]) => [attempt, url]),
    [
      [1, 'https://ledenchallenge.example.test/'],
      [2, 'https://ledenchallenge.example.test/'],
      [2, 'https://ledenchallenge.example.test/sign-in'],
      [2, 'https://ledenchallenge.example.test/sign-up'],
      [
        2,
        encodedLegacyInvitationUrl,
      ],
    ],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'sleep'),
    [['sleep', 25]],
  );
  assert.deepEqual(
    events
      .filter(([event]) => event === 'getAttribute')
      .map(([, attempt, selector, attribute]) => [attempt, selector, attribute]),
    [
      [2, 'meta[name="robots"]', 'content'],
      [2, 'meta[name="robots"]', 'content'],
      [2, 'meta[name="robots"]', 'content'],
      [2, 'meta[name="robots"]', 'content'],
    ],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'headersArray').map(([, attempt, url]) => [attempt, url]),
    [
      [1, 'https://ledenchallenge.example.test/'],
      [2, 'https://ledenchallenge.example.test/'],
      [2, 'https://ledenchallenge.example.test/sign-in'],
      [2, 'https://ledenchallenge.example.test/sign-up'],
      [
        2,
        encodedLegacyInvitationUrl,
      ],
    ],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'context.close'),
    [
      ['context.close', 1],
      ['context.close', 2],
    ],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'browser.close'),
    [
      ['browser.close', 1],
      ['browser.close', 2],
    ],
  );
  assert.ok(
    events.findIndex(([event, attempt]) => event === 'context.close' && attempt === 1) <
      events.findIndex(([event]) => event === 'sleep'),
  );
});

test('retries after context creation fails and closes the started browser before retrying', async () => {
  const activeBrowsers = new Set();
  const activeContexts = new Set();
  const closeCounts = {
    browser: new Map(),
    context: new Map(),
  };
  const lifecycle = [];
  let launchCount = 0;

  const browserLauncher = {
    async launch() {
      launchCount += 1;
      const attempt = launchCount;
      const mainFrame = {};
      let currentUrl = publicAppUrl.href;
      const listeners = new Map();
      const page = {
        on(eventName, listener) {
          listeners.set(eventName, listener);
        },
        mainFrame() {
          return mainFrame;
        },
        async goto(url) {
          currentUrl = url;
          const request = {
            isNavigationRequest: () => true,
            frame: () => mainFrame,
          };
          listeners.get('request')?.(request);
          listeners.get('response')?.({
            request: () => request,
            status: () => 200,
            url: () => url,
            async headersArray() {
              return [{ name: 'X-Robots-Tag', value: 'noindex, nofollow' }];
            },
          });
        },
        getByRole(role, options) {
          return {
            async waitFor() {
              currentUrl =
                options.name === 'Welkom terug'
                  ? 'https://ledenchallenge.example.test/sign-in'
                  : normalizeLegacyInvitationUrl(currentUrl);
            },
          };
        },
        getByText() {
          return {
            first() {
              return {
                async waitFor() {},
                async innerText() {
                  return 'This invitation is invalid or has expired.';
                },
              };
            },
          };
        },
        url() {
          return currentUrl;
        },
        locator() {
          return {
            async getAttribute() {
              return 'noindex, nofollow';
            },
          };
        },
      };

      const browser = {
        async newContext() {
          lifecycle.push(['newContext', attempt]);
          if (attempt === 1) {
            throw new Error('temporary context creation failure');
          }

          const context = {
            async newPage() {
              return page;
            },
            async clearCookies() {},
            async close() {
              lifecycle.push(['context.close', attempt]);
              closeCounts.context.set(attempt, (closeCounts.context.get(attempt) ?? 0) + 1);
              activeContexts.delete(context);
            },
          };

          activeContexts.add(context);
          return context;
        },
        async close() {
          lifecycle.push(['browser.close', attempt]);
          closeCounts.browser.set(attempt, (closeCounts.browser.get(attempt) ?? 0) + 1);
          activeBrowsers.delete(browser);
        },
      };

      activeBrowsers.add(browser);
      return browser;
    },
  };

  await smokePublishedEntryRoutes({
    environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
    browserLauncher,
    maxAttempts: 2,
    retryDelayMs: 25,
    sleep: async (delayMs) => {
      lifecycle.push(['sleep', delayMs]);
      assert.equal(activeBrowsers.size, 0);
      assert.equal(activeContexts.size, 0);
    },
  });

  assert.equal(launchCount, 2);
  assert.deepEqual([...closeCounts.browser.entries()], [
    [1, 1],
    [2, 1],
  ]);
  assert.deepEqual([...closeCounts.context.entries()], [[2, 1]]);
  assert.deepEqual(lifecycle, [
    ['newContext', 1],
    ['browser.close', 1],
    ['sleep', 25],
    ['newContext', 2],
    ['context.close', 2],
    ['browser.close', 2],
  ]);
  assert.equal(activeBrowsers.size, 0);
  assert.equal(activeContexts.size, 0);
});

test('closes each retry resource exactly once and leaves no resources after a later success', async () => {
  const activeBrowsers = new Set();
  const activeContexts = new Set();
  const closeCounts = {
    browser: new Map(),
    context: new Map(),
  };
  const lifecycle = [];
  let launchCount = 0;

  const browserLauncher = {
    async launch() {
      launchCount += 1;
      const attempt = launchCount;
      const mainFrame = {};
      let currentUrl = publicAppUrl.href;

      const page = {
        on() {},
        mainFrame() {
          return mainFrame;
        },
        async goto(url) {
          currentUrl = url;
          return {
            async headersArray() {
              return [{ name: 'X-Robots-Tag', value: 'noindex, nofollow' }];
            },
          };
        },
        getByRole(role, options) {
          return {
            async waitFor() {
              if (attempt < 3) {
                throw new Error(`temporary route failure on attempt ${attempt}`);
              }
              currentUrl =
                options.name === 'Welkom terug'
                  ? 'https://ledenchallenge.example.test/sign-in'
                  : normalizeLegacyInvitationUrl(currentUrl);
            },
          };
        },
        getByText() {
          return {
            first() {
              return {
                async waitFor() {},
                async innerText() {
                  return 'This invitation is invalid or has expired.';
                },
              };
            },
          };
        },
        url() {
          return currentUrl;
        },
        locator() {
          return {
            async getAttribute() {
              return 'noindex, nofollow';
            },
          };
        },
      };

      const context = {
        async newPage() {
          return page;
        },
        async clearCookies() {},
        async close() {
          lifecycle.push(['context.close', attempt]);
          closeCounts.context.set(attempt, (closeCounts.context.get(attempt) ?? 0) + 1);
          if (attempt === 2) {
            throw new Error('temporary context cleanup failure');
          }
          activeContexts.delete(context);
        },
      };

      const browser = {
        async newContext() {
          return context;
        },
        async close() {
          lifecycle.push(['browser.close', attempt]);
          closeCounts.browser.set(attempt, (closeCounts.browser.get(attempt) ?? 0) + 1);
          activeContexts.delete(context);
          activeBrowsers.delete(browser);
        },
      };

      activeBrowsers.add(browser);
      activeContexts.add(context);
      return browser;
    },
  };

  await smokePublishedEntryRoutes({
    environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
    browserLauncher,
    maxAttempts: 3,
    retryDelayMs: 25,
    sleep: async () => {
      assert.equal(activeContexts.size, 0);
      assert.equal(activeBrowsers.size, 0);
    },
  });

  assert.equal(launchCount, 3);
  assert.deepEqual([...closeCounts.context.entries()], [
    [1, 1],
    [2, 1],
    [3, 1],
  ]);
  assert.deepEqual([...closeCounts.browser.entries()], [
    [1, 1],
    [2, 1],
    [3, 1],
  ]);
  assert.deepEqual(lifecycle, [
    ['context.close', 1],
    ['browser.close', 1],
    ['context.close', 2],
    ['browser.close', 2],
    ['context.close', 3],
    ['browser.close', 3],
  ]);
  assert.equal(activeContexts.size, 0);
  assert.equal(activeBrowsers.size, 0);
});

test('reports the final browser failure after exhausting retries and closes every resource', async () => {
  const events = [];
  const attemptErrors = [
    new Error('publication still warming up'),
    new Error('final browser navigation failure'),
  ];
  let launchCount = 0;

  const browserLauncher = {
    async launch() {
      launchCount += 1;
      const attempt = launchCount;
      const context = {
        async newPage() {
          throw attemptErrors[attempt - 1];
        },
        async close() {
          events.push(['context.close', attempt]);
        },
      };

      return {
        async newContext() {
          return context;
        },
        async close() {
          events.push(['browser.close', attempt]);
        },
      };
    },
  };

  await assert.rejects(
    smokePublishedEntryRoutes({
      environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
      browserLauncher,
      maxAttempts: 2,
      retryDelayMs: 25,
      sleep: async (delayMs) => events.push(['sleep', delayMs]),
    }),
    (error) => {
      assert.match(
        error.message,
        /Failed to verify the published entry routes after 2 attempts: final browser navigation failure/,
      );
      assert.equal(error.cause, attemptErrors[1]);
      return true;
    },
  );

  assert.equal(launchCount, 2);
  assert.deepEqual(
    events.filter(([event]) => event === 'sleep'),
    [['sleep', 25]],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'context.close'),
    [
      ['context.close', 1],
      ['context.close', 2],
    ],
  );
  assert.deepEqual(
    events.filter(([event]) => event === 'browser.close'),
    [
      ['browser.close', 1],
      ['browser.close', 2],
    ],
  );
});

test('preserves the route failure when context cleanup also fails and still closes the browser', async () => {
  const events = [];
  const routeError = new Error('published sign-in route failed');
  const cleanupError = new Error('context cleanup failed');

  const browserLauncher = {
    async launch() {
      const context = {
        async newPage() {
          throw routeError;
        },
        async close() {
          events.push('context.close');
          throw cleanupError;
        },
      };

      return {
        async newContext() {
          return context;
        },
        async close() {
          events.push('browser.close');
        },
      };
    },
  };

  await assert.rejects(
    smokePublishedEntryRoutes({
      environment: { VITE_PUBLIC_APP_URL: publicAppUrl.href },
      browserLauncher,
      maxAttempts: 1,
    }),
    (error) => {
      assert.match(
        error.message,
        /Failed to verify the published entry routes after 1 attempts: published sign-in route failed/,
      );
      assert.equal(error.cause, routeError);
      return true;
    },
  );

  assert.deepEqual(events, ['context.close', 'browser.close']);
});
