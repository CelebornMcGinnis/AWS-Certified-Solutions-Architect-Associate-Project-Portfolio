// Values pulled directly from the live, already-deployed resources this app
// imports (see the migration plan). Keeping them here instead of scattered
// across stacks makes it obvious what's a "just reference reality" constant
// vs. an actual architectural decision made in a stack file.

export const AWS_ACCOUNT = '942960194803';
export const AWS_REGION = 'us-east-1';

export const HOSTED_ZONE_ID = 'Z025981818X4UKXUH8E7I';
export const HOSTED_ZONE_NAME = 'mcginnisarchitecture.com';

// Both certs already exist in ACM (us-east-1, required for CloudFront) and
// are reused as-is -- this app never requests or replaces them.
export const APEX_CERTIFICATE_ARN =
  'arn:aws:acm:us-east-1:942960194803:certificate/56b64a06-2711-4004-815e-5b4f3da6a424';
export const WILDCARD_CERTIFICATE_ARN =
  'arn:aws:acm:us-east-1:942960194803:certificate/c223b909-449a-4359-ac8f-3beb6a101446';

export const SITE_ORIGIN = 'https://mcginnisarchitecture.com';
export const BETA_SITE_ORIGIN = 'https://betaweb.mcginnisarchitecture.com';

export const SES_FROM_ADDRESS = 'no-reply@mcginnisarchitecture.com';
export const SES_TO_ADDRESS = 'mcginnisarchitecture@gmail.com';
