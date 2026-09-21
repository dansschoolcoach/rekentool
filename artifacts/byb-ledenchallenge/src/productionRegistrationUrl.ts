const configurationName = 'VITE_PUBLIC_APP_URL';

export function buildProductionRegistrationUrl(
  publicAppUrl: string | undefined,
): string {
  if (!publicAppUrl) {
    throw new Error(
      `${configurationName} environment variable is required but was not provided. Set it to the public production origin used in registration instructions.`,
    );
  }

  let origin: URL;
  try {
    origin = new URL(publicAppUrl);
  } catch {
    throw new Error(
      `Invalid ${configurationName} value: "${publicAppUrl}". Expected an HTTPS production origin such as "https://challenge.example.nl".`,
    );
  }

  if (
    origin.protocol !== 'https:' ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  ) {
    throw new Error(
      `Invalid ${configurationName} value: "${publicAppUrl}". Expected an HTTPS origin without credentials, a path, query, or hash.`,
    );
  }

  return new URL('/sign-up', origin).toString();
}