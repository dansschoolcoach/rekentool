import { buildProductionRegistrationUrl } from './productionRegistrationUrl.ts';

const expectedPublicAppOrigin = 'https://byb.ninnydooms.nl';

export function validatePublicAppUrl(publicAppUrl: string | undefined): void {
  const registrationUrl = buildProductionRegistrationUrl(publicAppUrl);
  const configuredPublicAppOrigin = new URL(registrationUrl).origin;

  if (configuredPublicAppOrigin !== expectedPublicAppOrigin) {
    throw new Error(
      `VITE_PUBLIC_APP_URL points to "${configuredPublicAppOrigin}", but ByB Ledenchallenge is published at "${expectedPublicAppOrigin}". Update the deployment environment value before releasing.`,
    );
  }
}
