import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import { KinesisEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { SITE_ORIGIN, BETA_SITE_ORIGIN } from './config';

const BACKEND_DIR = path.join(__dirname, '../../projects/realtime-ops-dashboard/backend');

export interface RealtimeOpsDashboardStackProps extends cdk.StackProps {
  stage: 'prod' | 'beta';
}

/**
 * Reference architecture only -- intentionally NEVER instantiated in
 * cdk/bin/portfolio.ts. Kinesis bills per shard-hour regardless of
 * traffic (~$15-20/month minimum for one shard), which isn't justified
 * for a portfolio demo that would otherwise sit idle almost all the
 * time. This file exists to be tsc/`cdk synth`-checked as real,
 * compilable reference code -- see projects/realtime-ops-dashboard/
 * README.md for the full rationale and what the live page's simulated
 * demo does instead.
 *
 * Kinesis Data Stream -> Lambda (EventSourceMapping, batched) ->
 * DynamoDB rollup counters -> HTTP API read route. Modeled on
 * workflow-visualizer-stack.ts's shape (same stage/origin/removalPolicy
 * pattern, same Lambda defaults).
 */
export class RealtimeOpsDashboardStack extends cdk.Stack {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: RealtimeOpsDashboardStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const namePrefix = stage === 'prod' ? 'realtime-ops-dashboard' : 'realtime-ops-dashboard-beta';
    const origin = stage === 'prod' ? SITE_ORIGIN : BETA_SITE_ORIGIN;
    const removalPolicy = cdk.RemovalPolicy.DESTROY;

    // --- Ingestion ---
    const eventStream = new kinesis.Stream(this, 'EventStream', {
      streamName: namePrefix,
      shardCount: 1,
      retentionPeriod: cdk.Duration.hours(24),
      removalPolicy,
    });

    // --- Rollups ---
    const rollupsTable = new dynamodb.Table(this, 'RollupsTable', {
      partitionKey: { name: 'region', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    const functionDefaults: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      code: lambda.Code.fromAsset(BACKEND_DIR),
    };

    // --- Aggregation consumer ---
    const aggregateFunction = new lambda.Function(this, 'AggregateEventsFunction', {
      ...functionDefaults,
      handler: 'aggregate_events_handler.lambda_handler',
      environment: { TABLE_NAME: rollupsTable.tableName },
    } as lambda.FunctionProps);
    rollupsTable.grantWriteData(aggregateFunction);

    aggregateFunction.addEventSource(new KinesisEventSource(eventStream, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 100,
      maxBatchingWindow: cdk.Duration.seconds(2),
      retryAttempts: 3,
      reportBatchItemFailures: true,
    }));

    // --- Read API for the dashboard to poll ---
    const getRollupsFunction = new lambda.Function(this, 'GetRollupsFunction', {
      ...functionDefaults,
      handler: 'get_rollups_handler.lambda_handler',
      environment: { TABLE_NAME: rollupsTable.tableName, ALLOWED_ORIGIN: origin },
    } as lambda.FunctionProps);
    rollupsTable.grantReadData(getRollupsFunction);

    const dashboardApi = new apigwv2.HttpApi(this, 'DashboardApi', {
      apiName: namePrefix,
      corsPreflight: {
        allowOrigins: [origin],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type'],
      },
    });
    dashboardApi.addRoutes({
      path: '/rollups',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetRollupsIntegration', getRollupsFunction),
    });

    this.apiEndpoint = dashboardApi.apiEndpoint;

    new cdk.CfnOutput(this, 'DashboardApiEndpoint', {
      description: 'What this stack would expose as apiBase, if it were ever instantiated',
      value: this.apiEndpoint,
    });
  }
}
