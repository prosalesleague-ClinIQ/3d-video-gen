#!/usr/bin/env python3
"""Create MinIO bucket. Idempotent — skips if bucket exists."""
import sys

from minio import Minio
from minio.error import S3Error

import env


def main() -> int:
    print(f"Connecting to MinIO at {env.MINIO_ENDPOINT}")
    try:
        client = Minio(
            env.MINIO_ENDPOINT,
            access_key=env.MINIO_ACCESS_KEY,
            secret_key=env.MINIO_SECRET_KEY,
            secure=env.MINIO_SECURE,
        )

        bucket = env.MINIO_BUCKET
        if client.bucket_exists(bucket):
            print(f"  [SKIP] Bucket '{bucket}' exists")
        else:
            client.make_bucket(bucket)
            print(f"  [OK] Created bucket '{bucket}'")

        # Create smoke test prefix marker
        from io import BytesIO
        marker = BytesIO(b"")
        try:
            client.put_object(bucket, "smoke/.keep", marker, 0)
            print(f"  [OK] Created smoke/ prefix")
        except S3Error:
            print(f"  [SKIP] smoke/ prefix exists")

        print("MinIO ready.")
        return 0
    except Exception as exc:
        print(f"  [FAIL] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
