export function parseBooleanEnvVar(value: string | undefined): boolean {
  return ['true', '1'].includes(value?.toLowerCase() ?? '');
}
