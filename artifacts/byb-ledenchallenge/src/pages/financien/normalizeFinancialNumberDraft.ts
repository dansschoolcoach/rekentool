export function normalizeFinancialNumberDraft(value: string) {
  if (value === '') return '';
  const decimal = value.replace(',', '.').replace(/[^\d.]/g, '');
  const [whole = '', ...fractions] = decimal.split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  return fractions.length > 0
    ? `${normalizedWhole}.${fractions.join('')}`
    : normalizedWhole;
}