import { ApiError } from '@workspace/api-client-react';

export function financialSaveError(
  error: unknown,
  inputLabel: string,
): { title: string; description: string } {
  if (error instanceof ApiError && (error.status === 400 || error.status === 422)) {
    const validationMessage = error.data && typeof error.data === 'object'
      ? (error.data as Record<string, unknown>).error
      : null;

    return {
      title: `Controleer ${inputLabel}`,
      description: typeof validationMessage === 'string' && validationMessage.trim()
        ? validationMessage
        : 'Een of meer velden zijn niet geldig. Controleer de invoer en probeer opnieuw.',
    };
  }

  if (!(error instanceof ApiError) || error.status >= 500) {
    return {
      title: 'Opslaan tijdelijk niet gelukt',
      description: 'De verbinding of server is tijdelijk niet beschikbaar. Je invoer blijft staan; probeer het zo opnieuw.',
    };
  }

  return {
    title: 'Opslaan mislukt',
    description: 'De gegevens konden niet worden opgeslagen. Je invoer blijft staan; probeer opnieuw.',
  };
}