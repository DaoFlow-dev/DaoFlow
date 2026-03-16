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
