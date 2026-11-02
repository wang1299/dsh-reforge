/** Immutable compatibility identities. Never use these for current branding. */
export const legacyConfigEnvironment = 'DSH_EVOLVE_CONFIG';
export const legacyMessageKind = 'dsh-evolve-experience';
export const legacyProfileId = 'dsh-evolve';
// Existing v1 diagnostic receipts must retain the original hashing domain.
export const usageFingerprintDomainV1 = 'dsh-evolve/usage-field/v1\0';
export const firstPublishedArtifact = {
  version: '0.1.0-alpha.1',
  repository: 'wang1299/dsh-evolve',
  sourceCommit: '4bd55a594ac75bdf4cfb331d94944026bbcc1578',
  sha256: 'c84fc11d789359a65f9e58397883f4d1026d359a0cca71867b1fa567729d8bd3',
  integrity: 'sha512-w7zBexq4mJrnvF+VnsVe8iN9+cBNQqos3JH/biKuHF5TRQ+IO63SuZetME/hAd+/O8LH2hQNkDNLl5qqXDP25w==',
  shasum: '77d38e9e5f0e3bf37b730d1da935162b09432e88',
} as const;
