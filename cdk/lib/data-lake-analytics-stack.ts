import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';
import { SITE_ORIGIN, BETA_SITE_ORIGIN } from './config';

const BACKEND_DIR = path.join(__dirname, '../../projects/data-lake-analytics/backend');

export interface DataLakeAnalyticsStackProps extends cdk.StackProps {
  stage: 'prod' | 'beta';
}

/**
 * Reference architecture ONLY -- this stack is intentionally never
 * imported or instantiated in cdk/bin/portfolio.ts, so `cdk deploy` can
 * never touch it. See projects/data-lake-analytics/README.md for why: an
 * S3 + Glue + Athena data lake is cheap to run at rest, but QuickSight's
 * per-seat licensing (~$9-24/user/month) isn't justified for a portfolio
 * demo that would otherwise sit idle. This file exists to be
 * `tsc`/`cdk synth`-checked as real, compilable code -- documentation
 * that can't silently drift out of date the way a written diagram can --
 * not to ever run `cdk deploy` against.
 *
 * Only Glue's stable L1 constructs are used below (CfnDatabase,
 * CfnCrawler, CfnTable) rather than an L2/alpha module, since that's what
 * this repo's installed aws-cdk-lib version actually ships. QuickSight
 * itself is deliberately NOT provisioned here -- it's an account-level
 * subscription with its own seat-based billing, not a per-stack resource,
 * so including a QuickSight construct here wouldn't reflect how it's
 * really adopted.
 */
export class DataLakeAnalyticsStack extends cdk.Stack {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: DataLakeAnalyticsStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const namePrefix = stage === 'prod' ? 'data-lake-analytics' : 'data-lake-analytics-beta';
    const origin = stage === 'prod' ? SITE_ORIGIN : BETA_SITE_ORIGIN;
    // Never deployed on either stage, so a full teardown on destroy is
    // always the right default -- there's no real data to protect.
    const removalPolicy = cdk.RemovalPolicy.DESTROY;

    const rawZoneBucket = new s3.Bucket(this, 'RawZoneBucket', {
      bucketName: `${namePrefix}-raw-zone-${this.account}`,
      removalPolicy,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const queryResultsBucket = new s3.Bucket(this, 'QueryResultsBucket', {
      bucketName: `${namePrefix}-query-results-${this.account}`,
      removalPolicy,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{ expiration: cdk.Duration.days(7) }],
    });

    const glueDatabase = new glue.CfnDatabase(this, 'CatalogDatabase', {
      catalogId: this.account,
      databaseInput: { name: namePrefix.replace(/-/g, '_') },
    });

    const crawlerRole = new iam.Role(this, 'CrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')],
    });
    rawZoneBucket.grantRead(crawlerRole);

    const crawler = new glue.CfnCrawler(this, 'RawZoneCrawler', {
      name: `${namePrefix}-crawler`,
      role: crawlerRole.roleArn,
      databaseName: glueDatabase.databaseInput && (glueDatabase.databaseInput as glue.CfnDatabase.DatabaseInputProperty).name,
      targets: { s3Targets: [{ path: `s3://${rawZoneBucket.bucketName}/orders/` }] },
      schedule: { scheduleExpression: 'cron(0 3 * * ? *)' },
    });
    crawler.addDependency(glueDatabase);

    // The table this project's queries run against -- normally the
    // crawler above would create/update this automatically, but a
    // pre-declared CfnTable documents the expected schema explicitly
    // rather than leaving it purely to crawler inference.
    const ordersTable = new glue.CfnTable(this, 'OrdersTable', {
      catalogId: this.account,
      databaseName: (glueDatabase.databaseInput as glue.CfnDatabase.DatabaseInputProperty).name!,
      tableInput: {
        name: 'orders',
        tableType: 'EXTERNAL_TABLE',
        parameters: { classification: 'parquet' },
        storageDescriptor: {
          location: `s3://${rawZoneBucket.bucketName}/orders/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: { serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe' },
          columns: [
            { name: 'category', type: 'string' },
            { name: 'region', type: 'string' },
            { name: 'product', type: 'string' },
            { name: 'units', type: 'int' },
            { name: 'revenue', type: 'double' },
          ],
        },
      },
    });
    ordersTable.addDependency(glueDatabase);

    const workgroup = new athena.CfnWorkGroup(this, 'QueryWorkGroup', {
      name: `${namePrefix}-workgroup`,
      description: 'Scopes this demo\'s Athena queries to a dedicated result location and data-scanned limit.',
      workGroupConfiguration: {
        resultConfiguration: { outputLocation: `s3://${queryResultsBucket.bucketName}/` },
        bytesScannedCutoffPerQuery: 1_000_000_000, // 1 GB safety ceiling per query
        enforceWorkGroupConfiguration: true,
      },
    });

    // --- API Lambdas ---
    const functionDefaults: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      code: lambda.Code.fromAsset(BACKEND_DIR),
    };

    const runQueryFunction = new lambda.Function(this, 'RunQueryFunction', {
      ...functionDefaults,
      handler: 'run_query_handler.lambda_handler',
      environment: {
        WORKGROUP_NAME: workgroup.name,
        GLUE_DATABASE: (glueDatabase.databaseInput as glue.CfnDatabase.DatabaseInputProperty).name!,
        GLUE_TABLE: ordersTable.ref,
        ALLOWED_ORIGIN: origin,
      },
    } as lambda.FunctionProps);
    runQueryFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['athena:StartQueryExecution'],
      resources: [`arn:aws:athena:${this.region}:${this.account}:workgroup/${workgroup.name}`],
    }));
    runQueryFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['glue:GetTable', 'glue:GetDatabase'],
      resources: ['*'],
    }));
    rawZoneBucket.grantRead(runQueryFunction);
    queryResultsBucket.grantReadWrite(runQueryFunction);

    const getQueryStatusFunction = new lambda.Function(this, 'GetQueryStatusFunction', {
      ...functionDefaults,
      handler: 'get_query_status_handler.lambda_handler',
      environment: { ALLOWED_ORIGIN: origin },
    } as lambda.FunctionProps);
    getQueryStatusFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['athena:GetQueryExecution', 'athena:GetQueryResults'],
      resources: [`arn:aws:athena:${this.region}:${this.account}:workgroup/${workgroup.name}`],
    }));
    queryResultsBucket.grantRead(getQueryStatusFunction);

    // --- API ---
    const queryApi = new apigwv2.HttpApi(this, 'QueryApi', {
      apiName: namePrefix,
      corsPreflight: {
        allowOrigins: [origin],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type'],
      },
    });
    queryApi.addRoutes({
      path: '/query',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('RunQueryIntegration', runQueryFunction),
    });
    queryApi.addRoutes({
      path: '/query/{queryExecutionId}',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetQueryStatusIntegration', getQueryStatusFunction),
    });

    this.apiEndpoint = queryApi.apiEndpoint;

    new cdk.CfnOutput(this, 'QueryApiEndpoint', {
      description: 'Reference-only value -- this stack is never deployed, so this output never actually resolves. See the README.',
      value: this.apiEndpoint,
    });
  }
}
