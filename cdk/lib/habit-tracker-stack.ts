import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import { SITE_ORIGIN, BETA_SITE_ORIGIN } from './config';

const BACKEND_DIR = path.join(__dirname, '../../projects/habit-tracker/backend');

export interface HabitTrackerStackProps extends cdk.StackProps {
  stage: 'prod' | 'beta';
}

/**
 * Anonymous, device-local habit tracker -- no sign-up, no Cognito. The
 * browser generates a random id and stores it in localStorage; that id is
 * sent as plain request data and trusted as-is. This is a deliberate,
 * disclosed-on-the-page tradeoff (see the frontend's device notice), not
 * an oversight -- there's nothing here worth the friction of a real
 * account system, and the moderated-image-gallery project already covers
 * what a properly authenticated project on this site looks like.
 *
 * The interesting AWS piece is EventBridge Scheduler: a once-daily cron
 * job invokes ResetStreaksFunction, which scans every habit and zeroes
 * out any streak whose owner didn't check in yesterday. Nothing else on
 * this site uses a scheduled background job -- every other project only
 * reacts to a request or an S3 event.
 */
export class HabitTrackerStack extends cdk.Stack {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: HabitTrackerStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const origin = stage === 'prod' ? SITE_ORIGIN : BETA_SITE_ORIGIN;
    // Neither stage holds anything real -- an anonymous, device-local demo
    // has no data worth protecting past a redeploy, so both tear down
    // completely, same reasoning as moderated-image-gallery.
    const removalPolicy = cdk.RemovalPolicy.DESTROY;

    // --- Storage ---
    const habitsTable = new dynamodb.Table(this, 'HabitsTable', {
      partitionKey: { name: 'habitId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });
    habitsTable.addGlobalSecondaryIndex({
      indexName: 'OwnerIndex',
      partitionKey: { name: 'ownerId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const checkInsTable = new dynamodb.Table(this, 'CheckInsTable', {
      partitionKey: { name: 'habitId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING }, // "YYYY-MM-DD"
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    // --- Lambdas ---
    const functionDefaults: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      code: lambda.Code.fromAsset(BACKEND_DIR),
      environment: {
        HABITS_TABLE: habitsTable.tableName,
        CHECKINS_TABLE: checkInsTable.tableName,
        ALLOWED_ORIGIN: origin,
      },
    };

    const createHabitFunction = new lambda.Function(this, 'CreateHabitFunction', {
      ...functionDefaults,
      handler: 'create_habit_handler.lambda_handler',
    } as lambda.FunctionProps);
    habitsTable.grantWriteData(createHabitFunction);

    const listHabitsFunction = new lambda.Function(this, 'ListHabitsFunction', {
      ...functionDefaults,
      handler: 'list_habits_handler.lambda_handler',
    } as lambda.FunctionProps);
    habitsTable.grantReadData(listHabitsFunction);

    const deleteHabitFunction = new lambda.Function(this, 'DeleteHabitFunction', {
      ...functionDefaults,
      handler: 'delete_habit_handler.lambda_handler',
    } as lambda.FunctionProps);
    habitsTable.grantReadWriteData(deleteHabitFunction);
    checkInsTable.grantReadWriteData(deleteHabitFunction);

    const checkInFunction = new lambda.Function(this, 'CheckInFunction', {
      ...functionDefaults,
      handler: 'check_in_handler.lambda_handler',
    } as lambda.FunctionProps);
    habitsTable.grantReadWriteData(checkInFunction);
    checkInsTable.grantWriteData(checkInFunction);

    const listCheckInsFunction = new lambda.Function(this, 'ListCheckInsFunction', {
      ...functionDefaults,
      handler: 'list_checkins_handler.lambda_handler',
    } as lambda.FunctionProps);
    habitsTable.grantReadData(listCheckInsFunction);
    checkInsTable.grantReadData(listCheckInsFunction);

    const resetStreaksFunction = new lambda.Function(this, 'ResetStreaksFunction', {
      ...functionDefaults,
      timeout: cdk.Duration.seconds(30), // scans every habit, not just one
      handler: 'reset_streaks_handler.lambda_handler',
    } as lambda.FunctionProps);
    habitsTable.grantReadWriteData(resetStreaksFunction);

    // --- Daily streak reset ---
    // Runs shortly after each UTC day rolls over. "Shortly after," not
    // exactly at midnight, so a habit checked in right at the boundary
    // doesn't race the job that would otherwise reset it.
    new scheduler.Schedule(this, 'DailyStreakReset', {
      schedule: scheduler.ScheduleExpression.cron({ minute: '10', hour: '0' }),
      target: new schedulerTargets.LambdaInvoke(resetStreaksFunction, {}),
      description: `Zeroes out any habit-tracker (${stage}) streak whose owner missed yesterday's check-in.`,
    });

    // --- API ---
    const api = new apigwv2.HttpApi(this, 'HabitApi', {
      apiName: stage === 'prod' ? 'habit-tracker' : 'habit-tracker-beta',
      corsPreflight: {
        allowOrigins: [origin],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type'],
      },
    });

    api.addRoutes({
      path: '/habits',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('CreateHabitIntegration', createHabitFunction),
    });
    api.addRoutes({
      path: '/habits',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListHabitsIntegration', listHabitsFunction),
    });
    api.addRoutes({
      path: '/habits/{id}',
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('DeleteHabitIntegration', deleteHabitFunction),
    });
    api.addRoutes({
      path: '/habits/{id}/checkins',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('CheckInIntegration', checkInFunction),
    });
    api.addRoutes({
      path: '/habits/{id}/checkins',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListCheckInsIntegration', listCheckInsFunction),
    });

    this.apiEndpoint = api.apiEndpoint;

    new cdk.CfnOutput(this, 'HabitApiEndpoint', {
      description: 'Value to paste into projects/habit-tracker/frontend/config.js as apiBase',
      value: this.apiEndpoint,
    });
  }
}
