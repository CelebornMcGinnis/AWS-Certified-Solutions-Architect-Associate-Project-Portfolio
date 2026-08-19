import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { SITE_ORIGIN, BETA_SITE_ORIGIN } from './config';

const BACKEND_DIR = path.join(__dirname, '../../projects/workflow-visualizer/backend');
const ALLOWED_ORIGINS = [SITE_ORIGIN, BETA_SITE_ORIGIN];

/**
 * Workflow visualizer demo: submit a job, watch it advance through
 * VALIDATING -> PROCESSING -> COMPLETE. The state machine owns every
 * status transition itself via Step Functions' native DynamoDB
 * integration (no Lambda in the state machine at all) -- Lambda only
 * handles the API surface (create/read/list).
 *
 * Greenfield stack, no existing live resource to match, so this uses
 * ordinary L2 constructs throughout (unlike fanning-sns/live-poll, which
 * had to reproduce an already-deployed template's L1 shape exactly).
 */
export class WorkflowVisualizerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const jobsTable = new dynamodb.Table(this, 'JobsTable', {
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    jobsTable.addGlobalSecondaryIndex({
      indexName: 'RecentIndex',
      partitionKey: { name: 'gsiPk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // --- State machine: every real status transition happens here, via
    // DynamoDB's native SDK integration -- no Lambda glue in between. ---
    const updateStatus = (id: string, status: string) =>
      new tasks.DynamoUpdateItem(this, id, {
        table: jobsTable,
        key: { jobId: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.jobId')) },
        updateExpression: 'SET #s = :s, updatedAt = :t',
        expressionAttributeNames: { '#s': 'status' },
        expressionAttributeValues: {
          ':s': tasks.DynamoAttributeValue.fromString(status),
          ':t': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
        },
        resultPath: sfn.JsonPath.DISCARD,
      });

    const definition = updateStatus('SetValidating', 'VALIDATING')
      .next(new sfn.Wait(this, 'WaitAfterValidating', { time: sfn.WaitTime.duration(cdk.Duration.seconds(5)) }))
      .next(updateStatus('SetProcessing', 'PROCESSING'))
      .next(new sfn.Wait(this, 'WaitAfterProcessing', { time: sfn.WaitTime.duration(cdk.Duration.seconds(8)) }))
      .next(updateStatus('SetComplete', 'COMPLETE'));

    const stateMachine = new sfn.StateMachine(this, 'JobStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.minutes(2),
    });

    // --- API Lambdas ---
    const functionDefaults: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      code: lambda.Code.fromAsset(BACKEND_DIR),
    };

    const createJobFunction = new lambda.Function(this, 'CreateJobFunction', {
      ...functionDefaults,
      handler: 'create_job_handler.lambda_handler',
      environment: {
        TABLE_NAME: jobsTable.tableName,
        STATE_MACHINE_ARN: stateMachine.stateMachineArn,
        ALLOWED_ORIGIN: ALLOWED_ORIGINS.join(','),
      },
    } as lambda.FunctionProps);
    jobsTable.grantWriteData(createJobFunction);
    stateMachine.grantStartExecution(createJobFunction);

    const getJobFunction = new lambda.Function(this, 'GetJobFunction', {
      ...functionDefaults,
      handler: 'get_job_handler.lambda_handler',
      environment: { TABLE_NAME: jobsTable.tableName, ALLOWED_ORIGIN: ALLOWED_ORIGINS.join(',') },
    } as lambda.FunctionProps);
    jobsTable.grantReadData(getJobFunction);

    const recentJobsFunction = new lambda.Function(this, 'RecentJobsFunction', {
      ...functionDefaults,
      handler: 'recent_jobs_handler.lambda_handler',
      environment: { TABLE_NAME: jobsTable.tableName, ALLOWED_ORIGIN: ALLOWED_ORIGINS.join(',') },
    } as lambda.FunctionProps);
    jobsTable.grantReadData(recentJobsFunction);

    // --- API ---
    const jobsApi = new apigwv2.HttpApi(this, 'JobsApi', {
      apiName: 'workflow-visualizer',
      corsPreflight: {
        allowOrigins: ALLOWED_ORIGINS,
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type'],
      },
    });
    jobsApi.addRoutes({
      path: '/jobs',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('CreateJobIntegration', createJobFunction),
    });
    jobsApi.addRoutes({
      path: '/jobs/recent',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('RecentJobsIntegration', recentJobsFunction),
    });
    jobsApi.addRoutes({
      path: '/jobs/{jobId}',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetJobIntegration', getJobFunction),
    });

    new cdk.CfnOutput(this, 'JobsApiEndpoint', {
      description: 'Value to paste into projects/workflow-visualizer/frontend/config.js as apiBase',
      value: jobsApi.apiEndpoint,
    });
  }
}
