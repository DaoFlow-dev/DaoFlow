export interface RecoveryDestinationSummary {
  id: string;
  name: string;
  provider?: string | null;
  [key: string]: unknown;
}

export interface RecoveryCheck {
  status: string;
  detail: string;
  [key: string]: unknown;
}

export interface RecoveryVerification {
  success?: boolean;
  status?: string;
  completedAt?: string | null;
  error?: string | null;
  checks?: Record<string, RecoveryCheck>;
  [key: string]: unknown;
}

export interface RecoveryManifest {
  formatVersion?: number;
  bundleId?: string;
  appVersion?: string;
  schemaVersion?: string;
  createdAt?: string;
  database?: {
    engine?: string;
    version?: string;
    dumpFormat?: string;
    sha256?: string;
    [key: string]: unknown;
  };
  migrations?: {
    count?: number;
    latestHash?: string | null;
    [key: string]: unknown;
  };
  compatibility?: Record<string, unknown>;
  requiredExternalSecrets?: string[];
  recoveryKey?: {
    fingerprint?: string;
    rotatedAt?: string | null;
    [key: string]: unknown;
  };
  sanitization?: { clearedFields?: string[]; [key: string]: unknown };
  objects?: Record<string, string>;
  [key: string]: unknown;
}

export interface RecoveryPlan {
  isReady: boolean;
  status?: string;
  destinationId?: string;
  destination?: RecoveryDestinationSummary | null;
  destinationSummary?: RecoveryDestinationSummary | null;
  appVersion?: string;
  schemaVersion?: string;
  keyFingerprint?: string | null;
  keyRotatedAt?: string | null;
  checks?: RecoveryCheck[];
  preflightChecks?: RecoveryCheck[];
  compatibility?: Record<string, unknown>;
  requiredExternalSecrets?: string[];
  objectPaths?: Record<string, string>;
  verification?: RecoveryVerification | null;
  failureNextSteps?: string[];
  nextSteps?: string[];
  error?: string | null;
  [key: string]: unknown;
}

export interface RecoveryBundle {
  id: string;
  status: string;
  appVersion?: string;
  schemaVersion?: string;
  keyFingerprint?: string | null;
  keyRotatedAt?: string | null;
  destinationId?: string;
  destination?: RecoveryDestinationSummary | null;
  destinationSummary?: RecoveryDestinationSummary | null;
  objectPrefix?: string;
  bundleObjectPath?: string;
  manifestObjectPath?: string;
  latestManifestObjectPath?: string;
  objectPaths?: Record<string, string>;
  bundleChecksum?: string | null;
  databaseChecksum?: string | null;
  checksums?: Record<string, string | null>;
  sizeBytes?: string | number | null;
  manifest?: RecoveryManifest | null;
  verification?: RecoveryVerification | null;
  verificationResult?: RecoveryVerification | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  [key: string]: unknown;
}

export interface RecoveryMetadata {
  bundleId: string;
  destinationId?: string;
  destination?: RecoveryDestinationSummary | null;
  appVersion?: string;
  schemaVersion?: string;
  keyFingerprint?: string | null;
  keyRotatedAt?: string | null;
  objectPaths?: Record<string, string>;
  checksums?: Record<string, string | null>;
  manifest?: RecoveryManifest | null;
  requiredExternalSecrets?: string[];
  verification?: RecoveryVerification | null;
  [key: string]: unknown;
}

export interface RecoveryQueryState<T> {
  data?: T;
  isLoading: boolean;
  isFetching?: boolean;
  isError?: boolean;
  error?: unknown;
  refetch: () => unknown;
}

export interface RecoveryMutationState<T> {
  isPending: boolean;
  error?: unknown;
  mutateAsync: (input: { destinationId: string }) => Promise<T>;
}
