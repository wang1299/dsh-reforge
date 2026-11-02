/** Only exact versions with a required matrix job may be declared supported. */
export const supportedDshVersions = ['0.2.0-rc.2', '0.2.1-rc.5'] as const;
export type SupportedDshVersion = typeof supportedDshVersions[number];
export const dshPeerRange = supportedDshVersions.join(' || ');
export function assertSupportedDshVersion(version: string): asserts version is SupportedDshVersion {
  if (!(supportedDshVersions as readonly string[]).includes(version)) throw new Error('Unsupported DSH version: ' + version + '; tested versions: ' + supportedDshVersions.join(', '));
}
