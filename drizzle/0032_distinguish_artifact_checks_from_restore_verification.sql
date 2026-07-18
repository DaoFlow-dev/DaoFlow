UPDATE "backup_runs"
SET
  "artifact_checked_at" = COALESCE("artifact_checked_at", "verified_at"),
  "verified_at" = NULL
WHERE "verified_at" IS NOT NULL;
