import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  formatCertificateExpiry,
  getCertificateExpiryMessage,
  getCertificateExpiryState,
  getCertificateStatusClass,
  type CertificateAssetSummary
} from "./git-provider-certificate";

export const NO_CERTIFICATE_VALUE = "__none__";

export function GitProviderCertificateSelect({
  certificateAssets,
  value,
  onChange,
  id,
  testId,
  disabled = false
}: {
  certificateAssets: CertificateAssetSummary[];
  value: string | null;
  onChange: (certificateId: string | null) => void;
  id: string;
  testId: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} data-testid={`${testId}-label`}>
        Custom CA certificate
      </Label>
      <Select
        value={value ?? NO_CERTIFICATE_VALUE}
        onValueChange={(nextValue) =>
          onChange(nextValue === NO_CERTIFICATE_VALUE ? null : nextValue)
        }
      >
        <SelectTrigger id={id} disabled={disabled} data-testid={testId}>
          <SelectValue placeholder="Use public CA trust" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_CERTIFICATE_VALUE} data-testid={`${testId}-option-none`}>
            None (use public CA trust)
          </SelectItem>
          {certificateAssets.map((certificate) => (
            <SelectItem
              key={certificate.id}
              value={certificate.id}
              data-testid={`${testId}-option-${certificate.id}`}
            >
              {certificate.name} · {certificate.status}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground" data-testid={`${testId}-help`}>
        Select a managed certificate only for a Git host that uses a private CA.
      </p>
    </div>
  );
}

export function GitProviderCertificateDetails({
  certificate,
  unavailable = false,
  testId
}: {
  certificate: CertificateAssetSummary | null;
  unavailable?: boolean;
  testId: string;
}) {
  if (!certificate) {
    return (
      <p
        className={cn(
          "text-xs",
          unavailable ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
        )}
        data-testid={`${testId}-state`}
      >
        {unavailable
          ? "Selected CA certificate is unavailable. Expiry unknown."
          : "No custom CA certificate selected. Public CA trust will be used."}
      </p>
    );
  }

  const expiryState = getCertificateExpiryState(certificate.expiresAt);
  return (
    <div className="space-y-1 text-xs" data-testid={testId}>
      <p data-testid={`${testId}-name`}>CA certificate: {certificate.name}</p>
      <p className="break-all text-muted-foreground" data-testid={`${testId}-fingerprint`}>
        Fingerprint: {certificate.fingerprint}
      </p>
      <p
        className={getCertificateStatusClass(expiryState)}
        data-testid={`${testId}-expiry`}
        data-expiry-state={expiryState}
      >
        {getCertificateExpiryMessage(certificate.expiresAt)}
      </p>
      <p className="text-muted-foreground" data-testid={`${testId}-status`}>
        Asset status: {certificate.status} · expires{" "}
        {formatCertificateExpiry(certificate.expiresAt)}
      </p>
    </div>
  );
}
