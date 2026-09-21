export function getBlockedInternalNavigationTarget(
  href: string,
  currentUrl: string,
  hasUnsavedChanges: boolean,
): string | null {
  if (!hasUnsavedChanges) return null;

  const current = new URL(currentUrl);
  const target = new URL(href, current);
  if (target.origin !== current.origin) return null;

  const currentTarget = `${current.pathname}${current.search}${current.hash}`;
  const nextTarget = `${target.pathname}${target.search}${target.hash}`;
  return nextTarget === currentTarget ? null : nextTarget;
}