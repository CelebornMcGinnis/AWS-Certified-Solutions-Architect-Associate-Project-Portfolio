# Moderated Image Gallery — Architecture

Companion guide for `moderated-image-gallery.drawio`.

Reflects the actual CDK stack in `cdk/lib/moderated-image-gallery-stack.ts`. Storage
(S3 buckets, DynamoDB table) is greenfield and fully separate per stage, but
**authentication is shared** — this project and `website-chatbot` both use one Cognito
user pool (`SharedAuthStack`), so one account signs in to both.

## Flow

1. **Website Visitor** signs in via the shared **Amazon Cognito** user pool.
2. The frontend calls **Amazon API Gateway** (HTTP API, routes protected by a Cognito
   JWT authorizer) `POST /uploads`. The `CreateUploadFunction` Lambda writes a pending
   record to **Amazon DynamoDB** (`UploadsTable`) and returns a presigned PUT URL for
   the **quarantine S3 bucket** — the browser uploads the image file directly to S3,
   not through Lambda.
3. The quarantine bucket's `OBJECT_CREATED` event notification invokes the
   `ModerateUploadFunction` Lambda directly (no API Gateway involved in this step).
4. That Lambda calls **Amazon Rekognition** `DetectModerationLabels` on the object.
5. Based on the result, it moves the image to the **gallery S3 bucket** (approved) and
   updates the DynamoDB record — a `galleryPk` attribute is set only for approved
   images, so a dedicated `GalleryIndex` GSI naturally contains exactly the public
   gallery's contents with no read-time filtering.
6. `GET /gallery` (public, no auth) and `GET /uploads/mine` / `GET /uploads/{id}`
   (Cognito-protected) read back through two more Lambdas.

The diagram simplifies the upload path to a single "Invoke" edge from Lambda to
Rekognition; in the real stack, the moderation Lambda is triggered by an **S3 event
notification**, not a direct API call from the upload handler.

## Services

| Service | Role |
|---|---|
| Amazon Cognito | Shared user pool (with `website-chatbot`) for sign-in |
| Amazon API Gateway | HTTP API, JWT-authorized except `GET /gallery` |
| AWS Lambda | Create-upload, moderate-upload (S3-triggered), get, list-mine, get-gallery |
| Amazon S3 | Quarantine bucket (private uploads) and gallery bucket (approved images) |
| Amazon Rekognition | `DetectModerationLabels` content moderation |
| Amazon DynamoDB | `UploadsTable` with `OwnerIndex` and `GalleryIndex` GSIs |

## Key design decisions

- **Uploads never live in the website's hosting bucket.** The site's `BucketDeployment`
  prunes anything not in its own source on every deploy, which would silently delete
  uploaded images if they shared that bucket.
- **Moderation is event-driven, not synchronous.** The upload Lambda returns
  immediately after issuing a presigned URL; Rekognition review happens asynchronously
  once S3 confirms the object landed.
- **Both stages fully destroy.** Neither buckets nor the table hold anything a visitor
  couldn't just re-upload, so both prod and beta use `RemovalPolicy.DESTROY`.
