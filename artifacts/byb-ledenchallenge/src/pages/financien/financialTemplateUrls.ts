export const financialTemplateFilenames = {
  teachers: 'ByB-Cijfers-sjabloon-docenten.xlsx',
  subscriptions: 'ByB-Cijfers-sjabloon-abonnementen-en-rittenkaarten.xlsx',
} as const;

export function getFinancialTemplateUrls(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  return {
    teachers: `${normalizedBaseUrl}templates/${financialTemplateFilenames.teachers}`,
    subscriptions: `${normalizedBaseUrl}templates/${financialTemplateFilenames.subscriptions}`,
  };
}