const OVH_S3_HOST = "s3.us-west-or.io.cloud.ovh.us";

/**
 * Convert an OVH S3 URI into the public, virtual-hosted URL used for downloads.
 * HTTP(S) URLs and malformed S3 values are returned unchanged.
 */
export function resolveS3Url(url?: string): string {
  if (!url) return "";

  const match = /^s3:\/\/([^/]+)\/(.+)$/i.exec(url);
  if (!match) return url;

  const [, bucket, key] = match;
  const isValidBucket = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(bucket);
  if (!isValidBucket) return url;

  return `https://${bucket}.${OVH_S3_HOST}/${key}`;
}
