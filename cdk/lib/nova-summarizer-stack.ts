import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { SITE_ORIGIN, BETA_SITE_ORIGIN } from './config';

const BACKEND_DIR = path.join(__dirname, '../../projects/nova-summarizer/backend');

export interface NovaSummarizerStackProps extends cdk.StackProps {
  stage: 'prod' | 'beta';
}

/**
 * Public, unauthenticated text summarizer backed by Amazon Bedrock's Nova
 * Lite model -- the first GenAI project on this site. Public + unpaid
 * for a foundation-model call is a real cost risk, so this project
 * layers two independent limits rather than relying on either alone:
 *
 * 1. API Gateway stage throttling (rate/burst limit) -- stops a rapid
 *    burst of requests before Lambda even runs.
 * 2. A DynamoDB-backed daily counter, checked and atomically
 *    incremented inside the Lambda -- stops a slow, sustained trickle
 *    of requests from running up a real bill over a day, which pure
 *    request-rate throttling can't do.
 */
export class NovaSummarizerStack extends cdk.Stack {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: NovaSummarizerStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const origin = stage === 'prod' ? SITE_ORIGIN : BETA_SITE_ORIGIN;
    // No real data here either -- just a rolling daily request counter.
    const removalPolicy = cdk.RemovalPolicy.DESTROY;

    const usageTable = new dynamodb.Table(this, 'UsageTable', {
      partitionKey: { name: 'date', type: dynamodb.AttributeType.STRING }, // "YYYY-MM-DD"
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    const summarizeFunction = new lambda.Function(this, 'SummarizeFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(30), // Bedrock inference can take a few seconds
      memorySize: 128,
      code: lambda.Code.fromAsset(BACKEND_DIR),
      handler: 'summarize_handler.lambda_handler',
      environment: {
        USAGE_TABLE: usageTable.tableName,
        ALLOWED_ORIGIN: origin,
        // Nova Lite is invoked through its cross-region inference profile
        // rather than the bare foundation-model id -- Bedrock requires
        // this for on-demand throughput on newer model families.
        BEDROCK_MODEL_ID: 'us.amazon.nova-lite-v1:0',
        MAX_INPUT_CHARS: '6000',
        DAILY_REQUEST_LIMIT: stage === 'prod' ? '200' : '50',
      },
    });
    usageTable.grantReadWriteData(summarizeFunction);
    // Wildcard, not a pinned model ARN: an inference profile routes a
    // single invocation across whichever underlying regional model ARNs
    // it currently maps to, so scoping this to one region's foundation
    // -model ARN would be both fragile and incomplete. Same reasoning
    // moderate_upload_handler.py already applies to its Rekognition
    // permission in the moderated-image-gallery project.
    summarizeFunction.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: ['*'] }),
    );

    const api = new apigwv2.HttpApi(this, 'SummarizerApi', {
      apiName: stage === 'prod' ? 'nova-summarizer' : 'nova-summarizer-beta',
      createDefaultStage: false, // default stage is created explicitly below, with throttling
      corsPreflight: {
        allowOrigins: [origin],
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type'],
      },
    });

    new apigwv2.HttpStage(this, 'DefaultStage', {
      httpApi: api,
      stageName: '$default',
      autoDeploy: true,
      throttle: { rateLimit: 2, burstLimit: 5 },
    });

    api.addRoutes({
      path: '/summarize',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('SummarizeIntegration', summarizeFunction),
    });

    this.apiEndpoint = api.apiEndpoint;

    new cdk.CfnOutput(this, 'SummarizerApiEndpoint', {
      description: 'Value to paste into projects/nova-summarizer/frontend/config.js as apiBase',
      value: this.apiEndpoint,
    });
  }
}
