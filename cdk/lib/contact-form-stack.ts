import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import { SITE_ORIGIN, BETA_SITE_ORIGIN, SES_FROM_ADDRESS, SES_TO_ADDRESS } from './config';

const BACKEND_DIR = path.join(__dirname, '../../projects/contact-form-api/backend');

export interface ContactFormStackProps extends cdk.StackProps {
  stage: 'prod' | 'beta';
}

/**
 * For `stage: 'prod'`, adopts the contact-form-api backend exactly as it
 * exists in AWS today -- Lambda `prj1_call_SES` + HTTP API
 * `prj1_call_SES-API`, both created by hand in the console (not via the
 * repo's aspirational template.yaml, which used a `/contact` route on a
 * `$default` stage; the live API instead has GET/POST/ANY/OPTIONS routes
 * under `/prj1_call_SES` on a stage literally named "default", which is
 * what projects/contact-form-api/frontend/config.js actually points at).
 * Built from L1 (Cfn*) constructs deliberately -- this stack was designed
 * for a `cdk import` (see cdk/import-maps/contact-form-api.json), and L1
 * gives exact control over every property with none of the extra resources
 * (default log group, auto-generated role policy) that L2 constructs add.
 *
 * `stage: 'beta'` deploys this exact same shape as an entirely separate,
 * brand-new stack -- its own Lambda, role, and API, wired only to the beta
 * site origin. Nothing is shared with prod.
 */
export class ContactFormStack extends cdk.Stack {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: ContactFormStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const namePrefix = stage === 'prod' ? 'prj1_call_SES' : 'prj1_call_SES_beta';
    const origin = stage === 'prod' ? SITE_ORIGIN : BETA_SITE_ORIGIN;
    // Prod's resources were imported from hand-created originals, so they
    // keep the RETAIN safety net a stack delete can't override; beta's are
    // fresh resources with nothing at stake, so a destroy there is
    // genuinely complete.
    const removalPolicy = stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    const role = new iam.CfnRole(this, 'ContactFormFunctionRole', {
      path: '/service-role/',
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      },
      managedPolicyArns:
        stage === 'prod'
          ? [
              // Customer-managed copy the Lambda console generates for a
              // from-scratch execution role -- not the AWS-managed policy of
              // the same display name, so this ARN must be matched exactly.
              'arn:aws:iam::942960194803:policy/service-role/AWSLambdaBasicExecutionRole-aeb34e5a-0a83-4221-a0de-b92e92e70aaf',
              'arn:aws:iam::aws:policy/AmazonSESFullAccess',
            ]
          : [
              // Beta's role is newly created, not imported -- the standard
              // AWS-managed policy is the correct (and only sensible)
              // choice here.
              'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
              'arn:aws:iam::aws:policy/AmazonSESFullAccess',
            ],
    });
    role.applyRemovalPolicy(removalPolicy);

    // Verified byte-identical to the deployed function's code (diffed
    // against a download of the live package) at the time this stack was
    // written, so pointing the import at this asset is a no-op functionally
    // even though it lands at a new S3 location.
    const codeAsset = new s3assets.Asset(this, 'ContactFormCodeAsset', { path: BACKEND_DIR });

    const contactFormFunction = new lambda.CfnFunction(this, 'ContactFormFunction', {
      functionName: namePrefix,
      runtime: 'python3.12',
      timeout: 3,
      memorySize: 128,
      handler: 'lambda_function.lambda_handler',
      role: role.attrArn,
      code: { s3Bucket: codeAsset.s3BucketName, s3Key: codeAsset.s3ObjectKey },
      // Prod's Lambda has never set ALLOWED_ORIGIN (defaults to "*" in
      // lambda_function.py, which _site_url() falls back to the correct
      // hardcoded prod URL for anyway) -- left exactly as deployed today,
      // not touched here, so prod's Lambda config has zero drift from this
      // change. Beta's is a brand-new function, so it gets the real value
      // from the start: a correctly-scoped CORS header on its actual
      // responses, and correct beta-site links in its emails.
      environment:
        stage === 'prod'
          ? { variables: { SES_FROM_ADDRESS, SES_TO_ADDRESS } }
          : { variables: { SES_FROM_ADDRESS, SES_TO_ADDRESS, ALLOWED_ORIGIN: origin } },
    });
    contactFormFunction.applyRemovalPolicy(removalPolicy);

    const contactApi = new apigwv2.CfnApi(this, 'ContactApi', {
      name: `${namePrefix}-API`,
      protocolType: 'HTTP',
      corsConfiguration: {
        allowCredentials: false,
        allowHeaders: ['content-type'],
        allowMethods: ['OPTIONS', 'POST'],
        allowOrigins: [origin],
        maxAge: 0,
      },
    });
    contactApi.applyRemovalPolicy(removalPolicy);

    const integration = new apigwv2.CfnIntegration(this, 'ContactFormIntegration', {
      apiId: contactApi.ref,
      integrationType: 'AWS_PROXY',
      integrationMethod: 'POST',
      integrationUri: contactFormFunction.attrArn,
      payloadFormatVersion: '2.0',
      timeoutInMillis: 30000,
    });

    for (const [id, routeKey] of Object.entries({
      GetRoute: 'GET /prj1_call_SES',
      PostRoute: 'POST /prj1_call_SES',
      AnyRoute: 'ANY /prj1_call_SES',
      OptionsRoute: 'OPTIONS /prj1_call_SES',
    })) {
      new apigwv2.CfnRoute(this, id, {
        apiId: contactApi.ref,
        routeKey,
        target: `integrations/${integration.ref}`,
      });
    }

    new apigwv2.CfnStage(this, 'DefaultStage', {
      apiId: contactApi.ref,
      stageName: 'default',
      autoDeploy: true,
    });

    const invokePermission = new lambda.CfnPermission(this, 'ApiGatewayInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: contactFormFunction.ref,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:${this.partition}:execute-api:${this.region}:${this.account}:${contactApi.ref}/*/*/prj1_call_SES`,
    });
    if (stage === 'prod') {
      // CfnPermissionProps in this CDK version has no typed `id` field even
      // though the CFN resource schema (and its import primary identifier)
      // includes one -- set it via the raw-property escape hatch instead.
      // Only meaningful for the imported prod resource; beta's permission
      // is brand new and can use CloudFormation's auto-generated id.
      invokePermission.addPropertyOverride('Id', 'lambda-0db00959-1e9d-4c01-910d-3d9f1f02e945');
    }

    this.apiEndpoint = `https://${contactApi.ref}.execute-api.${this.region}.amazonaws.com/default/prj1_call_SES`;

    new cdk.CfnOutput(this, 'ContactApiEndpoint', {
      description: 'Value to paste into projects/contact-form-api/frontend/config.js as apiEndpoint',
      value: this.apiEndpoint,
    });
    new cdk.CfnOutput(this, 'ContactFormFunctionName', { value: contactFormFunction.ref });
  }
}
