import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import { SITE_ORIGIN, BETA_SITE_ORIGIN, SES_FROM_ADDRESS, SES_TO_ADDRESS } from './config';

const BACKEND_DIR = path.join(__dirname, '../../projects/contact-form-api/backend');

/**
 * Adopts the contact-form-api backend exactly as it exists in AWS today --
 * Lambda `prj1_call_SES` + HTTP API `prj1_call_SES-API`, both created by
 * hand in the console (not via the repo's aspirational template.yaml, which
 * used a `/contact` route on a `$default` stage; the live API instead has
 * GET/POST/ANY/OPTIONS routes under `/prj1_call_SES` on a stage literally
 * named "default", which is what projects/contact-form-api/frontend/config.js
 * actually points at). Built from L1 (Cfn*) constructs deliberately -- no
 * CloudFormation stack owns these resources yet, so this stack is designed
 * for a `cdk import` (see cdk/import-maps/contact-form-api.json), and L1
 * gives exact control over every property with none of the extra resources
 * (default log group, auto-generated role policy) that L2 constructs add.
 */
export class ContactFormStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const role = new iam.CfnRole(this, 'ContactFormFunctionRole', {
      path: '/service-role/',
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      },
      managedPolicyArns: [
        // Customer-managed copy the Lambda console generates for a
        // from-scratch execution role -- not the AWS-managed policy of the
        // same display name, so this ARN must be matched exactly.
        'arn:aws:iam::942960194803:policy/service-role/AWSLambdaBasicExecutionRole-aeb34e5a-0a83-4221-a0de-b92e92e70aaf',
        'arn:aws:iam::aws:policy/AmazonSESFullAccess',
      ],
    });
    role.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Verified byte-identical to the deployed function's code (diffed
    // against a download of the live package) at the time this stack was
    // written, so pointing the import at this asset is a no-op functionally
    // even though it lands at a new S3 location.
    const codeAsset = new s3assets.Asset(this, 'ContactFormCodeAsset', { path: BACKEND_DIR });

    const contactFormFunction = new lambda.CfnFunction(this, 'ContactFormFunction', {
      functionName: 'prj1_call_SES',
      runtime: 'python3.12',
      timeout: 3,
      memorySize: 128,
      handler: 'lambda_function.lambda_handler',
      role: role.attrArn,
      code: { s3Bucket: codeAsset.s3BucketName, s3Key: codeAsset.s3ObjectKey },
      environment: { variables: { SES_FROM_ADDRESS, SES_TO_ADDRESS } },
    });
    contactFormFunction.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    const contactApi = new apigwv2.CfnApi(this, 'ContactApi', {
      name: 'prj1_call_SES-API',
      protocolType: 'HTTP',
      corsConfiguration: {
        allowCredentials: false,
        allowHeaders: ['content-type'],
        allowMethods: ['OPTIONS', 'POST'],
        // The Lambda itself doesn't set ALLOWED_ORIGIN (defaults to "*" in
        // lambda_function.py), so real GET/POST responses already work from
        // any origin -- only this API-level allowlist (which gates the
        // OPTIONS preflight) needs widening for beta to work in a browser.
        allowOrigins: [SITE_ORIGIN, BETA_SITE_ORIGIN],
        maxAge: 0,
      },
    });
    contactApi.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

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
    // CfnPermissionProps in this CDK version has no typed `id` field even
    // though the CFN resource schema (and its import primary identifier)
    // includes one -- set it via the raw-property escape hatch instead.
    invokePermission.addPropertyOverride('Id', 'lambda-0db00959-1e9d-4c01-910d-3d9f1f02e945');

    new cdk.CfnOutput(this, 'ContactApiEndpoint', {
      description: 'Value to paste into projects/contact-form-api/frontend/config.js as apiEndpoint',
      value: `https://${contactApi.ref}.execute-api.${this.region}.amazonaws.com/default/prj1_call_SES`,
    });
    new cdk.CfnOutput(this, 'ContactFormFunctionName', { value: contactFormFunction.ref });
  }
}
