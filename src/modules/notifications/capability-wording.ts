/**
 * Turns permission descriptions (as seeded — see RoleService.describePermissions) into a phrase
 * that reads after "You can …": first letter lowercased, joined as "a, b and c". Used by LS_N_0005
 * ("You can {{capability_summary}}") and LS_N_0006 ("You can now {{added_capabilities}}").
 * Empty input gives an empty string.
 */
export function joinCapabilities(descriptions: string[]): string {
  const phrases = descriptions.map((d) => d.charAt(0).toLowerCase() + d.slice(1));
  if (phrases.length <= 1) return phrases.join('');
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
}
