import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { SITE_ORIGIN, BETA_SITE_ORIGIN } from './config';

const BACKEND_DIR = path.join(__dirname, '../../projects/moderated-image-gallery/backend');

export interface ModeratedImageGalleryStackProps extends cdk.StackProps {
  stage: 'prod' | 'beta';
}

/**
 * Authenticated upload -> Rekognition moderation -> public gallery demo.
 * Greenfield stack, no imported resource on either stage -- prod and beta
 * are entirely separate Cognito user pools, S3 buckets, and DynamoDB
 * tables, following the same pattern as every other project in this app.
 *
 * The quarantine and gallery buckets are deliberately NOT the website
 * hosting bucket: the website's BucketDeployment prunes anything not in
 * its own source on every deploy, which would silently delete uploaded
 * images if they lived in that same bucket.
 */
export class ModeratedImageGalleryStack extends cdk.Stack {
  public readonly apiEndpoint: string;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string, props: ModeratedImageGalleryStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const origin = stage === 'prod' ? SITE_ORIGIN : BETA_SITE_ORIGIN;
    // Neither stage holds anything a visitor couldn't just re-upload, and
    // beta in particular should tear down completely -- no orphaned
    // buckets/tables left behind. Prod matches the same "genuinely
    // destroyable" policy here since, unlike the other projects, this one
    // never had pre-existing real data to protect in the first place.
    const removalPolicy = cdk.RemovalPolicy.DESTROY;

    // --- Auth ---
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy,
    });
    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      generateSecret: false, // called directly from the browser, no server-side secret to keep
      authFlows: { userPassword: true },
    });
    this.userPoolId = userPool.userPoolId;
    this.userPoolClientId = userPoolClient.userPoolClientId;

    // --- Storage ---
    const quarantineBucket = new s3.Bucket(this, 'QuarantineBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.POST],
          allowedOrigins: [origin],
          allowedHeaders: ['*'],
        },
      ],
    });
    const galleryBucket = new s3.Bucket(this, 'GalleryBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy,
      autoDeleteObjects: true,
      // No CORS needed here -- served only via presigned GET URLs used as
      // <img>/<a> targets, neither of which triggers a CORS preflight.
    });

    const uploadsTable = new dynamodb.Table(this, 'UploadsTable', {
      partitionKey: { name: 'uploadId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });
    uploadsTable.addGlobalSecondaryIndex({
      indexName: 'OwnerIndex',
      partitionKey: { name: 'ownerSub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    uploadsTable.addGlobalSecondaryIndex({
      // galleryPk is only ever set (to "APPROVED") by the moderation
      // Lambda once an image clears review -- PENDING/REJECTED rows never
      // get this attribute at all, so this index naturally contains
      // exactly the public gallery's contents with no read-time filtering.
      indexName: 'GalleryIndex',
      partitionKey: { name: 'galleryPk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- Lambdas ---
    const functionDefaults: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      code: lambda.Code.fromAsset(BACKEND_DIR),
    };

    const createUploadFunction = new lambda.Function(this, 'CreateUploadFunction', {
      ...functionDefaults,
      handler: 'create_upload_handler.lambda_handler',
      environment: {
        TABLE_NAME: uploadsTable.tableName,
        QUARANTINE_BUCKET: quarantineBucket.bucketName,
        ALLOWED_ORIGIN: origin,
      },
    } as lambda.FunctionProps);
    uploadsTable.grantWriteData(createUploadFunction);
    quarantineBucket.grantPut(createUploadFunction);

    const moderateUploadFunction = new lambda.Function(this, 'ModerateUploadFunction', {
      ...functionDefaults,
      timeout: cdk.Duration.seconds(30), // Rekognition call can take longer than the API-facing Lambdas' 10s
      handler: 'moderate_upload_handler.lambda_handler',
      environment: {
        TABLE_NAME: uploadsTable.tableName,
        QUARANTINE_BUCKET: quarantineBucket.bucketName,
        GALLERY_BUCKET: galleryBucket.bucketName,
      },
    } as lambda.FunctionProps);
    uploadsTable.grantWriteData(moderateUploadFunction);
    quarantineBucket.grantRead(moderateUploadFunction);
    quarantineBucket.grantDelete(moderateUploadFunction);
    galleryBucket.grantPut(moderateUploadFunction);
    moderateUploadFunction.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['rekognition:DetectModerationLabels'], resources: ['*'] }),
    );
    quarantineBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(moderateUploadFunction),
    );

    const getUploadFunction = new lambda.Function(this, 'GetUploadFunction', {
      ...functionDefaults,
      handler: 'get_upload_handler.lambda_handler',
      environment: { TABLE_NAME: uploadsTable.tableName, ALLOWED_ORIGIN: origin },
    } as lambda.FunctionProps);
    uploadsTable.grantReadData(getUploadFunction);

    const listMyUploadsFunction = new lambda.Function(this, 'ListMyUploadsFunction', {
      ...functionDefaults,
      handler: 'list_my_uploads_handler.lambda_handler',
      environment: {
        TABLE_NAME: uploadsTable.tableName,
        GALLERY_BUCKET: galleryBucket.bucketName,
        ALLOWED_ORIGIN: origin,
      },
    } as lambda.FunctionProps);
    uploadsTable.grantReadData(listMyUploadsFunction);
    galleryBucket.grantRead(listMyUploadsFunction);

    const getGalleryFunction = new lambda.Function(this, 'GetGalleryFunction', {
      ...functionDefaults,
      handler: 'get_gallery_handler.lambda_handler',
      environment: {
        TABLE_NAME: uploadsTable.tableName,
        GALLERY_BUCKET: galleryBucket.bucketName,
        ALLOWED_ORIGIN: origin,
      },
    } as lambda.FunctionProps);
    uploadsTable.grantReadData(getGalleryFunction);
    galleryBucket.grantRead(getGalleryFunction);

    // --- API ---
    const authorizer = new HttpUserPoolAuthorizer('UploadsAuthorizer', userPool, {
      userPoolClients: [userPoolClient],
    });

    const api = new apigwv2.HttpApi(this, 'GalleryApi', {
      apiName: stage === 'prod' ? 'moderated-image-gallery' : 'moderated-image-gallery-beta',
      corsPreflight: {
        allowOrigins: [origin],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    api.addRoutes({
      path: '/uploads',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('CreateUploadIntegration', createUploadFunction),
      authorizer,
    });
    api.addRoutes({
      path: '/uploads/mine',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListMyUploadsIntegration', listMyUploadsFunction),
      authorizer,
    });
    api.addRoutes({
      path: '/uploads/{id}',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetUploadIntegration', getUploadFunction),
      authorizer,
    });
    api.addRoutes({
      path: '/gallery',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetGalleryIntegration', getGalleryFunction),
      // Public -- no authorizer. Visible to anyone, matching the rest of
      // this site's demos not gating read access behind an account.
    });

    this.apiEndpoint = api.apiEndpoint;

    new cdk.CfnOutput(this, 'GalleryApiEndpoint', {
      description: 'Value to paste into projects/moderated-image-gallery/frontend/config.js as apiBase',
      value: this.apiEndpoint,
    });
    new cdk.CfnOutput(this, 'CognitoUserPoolId', { value: this.userPoolId });
    new cdk.CfnOutput(this, 'CognitoUserPoolClientId', { value: this.userPoolClientId });
  }
}
