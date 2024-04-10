/**
 * Parse a boolean environment variable.
 * @param value
 */
export function parseBooleanEnvVar(value: string | undefined): boolean {
  return ['true', '1'].includes(value?.toLowerCase() ?? '');
}
