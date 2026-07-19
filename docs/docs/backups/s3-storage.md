---
sidebar_position: 5
---

# S3-Compatible Storage

DaoFlow supports any S3-compatible storage for backups: AWS S3, MinIO, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, etc.

## Configuration

Set the following environment variables:

```bash
S3_ENDPOINT=https://s3.amazonaws.com          # or your S3-compatible endpoint
S3_BUCKET=daoflow-backups
S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
S3_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_REGION=us-east-1                           # optional
```

## Provider Examples

### AWS S3

```bash
S3_ENDPOINT=https://s3.us-east-1.amazonaws.com
S3_BUCKET=my-daoflow-backups
S3_REGION=us-east-1
```

### MinIO (Self-Hosted)

```bash
S3_ENDPOINT=http://minio.local:9000
S3_BUCKET=backups
```

### Cloudflare R2

```bash
S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
S3_BUCKET=daoflow-backups
```

### Backblaze B2

```bash
S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
S3_BUCKET=daoflow-backups
```

## Storage Layout

Backups are stored with a structured key format:

```
s3://bucket/daoflow/
  └── org-id/
      └── service-name/
          └── 2026-03-15/
              ├── bkp_abc123_full.tar.gz
              └── bkp_abc123_metadata.json
```

## Verifying

```bash
daoflow doctor --json
# Includes S3 connectivity check
```

## Importing Existing PostgreSQL Archives

External archive import is disabled by default. Enable it only on an S3-compatible destination and
set a narrow approved prefix such as `database-imports/`. DaoFlow rejects keys outside that prefix,
objects above the configured byte limit, destinations using archive or rclone encryption, and
objects without a version ID or ETag.

The destination form exposes three settings:

- **Allow existing archive imports** — explicit opt-in
- **Approved prefix** — the only object-key namespace DaoFlow may browse or import
- **Maximum bytes** — enforced against both S3 metadata and the streamed download

CLI-only setup uses the equivalent destination flags:

```bash
daoflow backup destination add \
  --name migration-archives \
  --provider s3 \
  --bucket company-backups \
  --region us-east-1 \
  --allow-external-imports \
  --external-import-prefix database-imports/ \
  --max-external-import-bytes 2147483648 \
  --yes
```

Browse only the approved namespace, then register an exact key:

```bash
daoflow backup destination files --id dest_123 --json

daoflow backup external register \
  --destination dest_123 \
  --object-key database-imports/customer.dump \
  --postgres-major 17 \
  --yes \
  --json
```

Registration runs in the worker. DaoFlow pins the S3 version ID or ETag, streams the object while
calculating SHA-256, enforces the byte limit again, and inspects the archive with `pg_restore
--list`. V1 accepts PostgreSQL custom-format archives only. Imported objects become first-class
external artifacts; DaoFlow does not create a fake backup policy or backup run for them.

Changing or deleting the source object does not silently retarget the artifact. Later verification
and restore downloads reuse the pinned version or ETag and must reproduce the stored SHA-256.
