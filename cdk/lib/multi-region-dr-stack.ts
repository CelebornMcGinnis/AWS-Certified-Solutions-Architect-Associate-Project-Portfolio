import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { SITE_ORIGIN, BETA_SITE_ORIGIN, HOSTED_ZONE_ID, HOSTED_ZONE_NAME } from './config';

const BACKEND_DIR = path.join(__dirname, '../../projects/multi-region-dr/backend');

export interface MultiRegionDrStackProps extends cdk.StackProps {
  stage: 'prod' | 'beta';
}

/**
 * Reference architecture only -- INTENTIONALLY NEVER INSTANTIATED in
 * cdk/bin/portfolio.ts. Running a second region continuously (even at
 * the cheapest "pilot light" posture) costs real money whether or not a
 * failover ever happens, which isn't justified for a portfolio demo --
 * see projects/multi-region-dr/README.md's "Why this isn't deployed"
 * section for the actual numbers. This file exists to be `tsc`/`cdk
 * synth`-checked as real, compilable reference code, not dead
 * pseudo-code: it compiles and would deploy cleanly if it were ever
 * wired into bin/portfolio.ts, but nothing in this repo does that.
 *
 * Models a single region's half of a two-region failover pair (the
 * primary). A real deployment would instantiate this stack twice, once
 * per region, each pointed at a DynamoDB Global Table replica local to
 * that region, with Route 53 holding one PRIMARY and one SECONDARY
 * record set tied to a health check against this stack's API.
 */
export class MultiRegionDrStack extends cdk.Stack {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: MultiRegionDrStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const namePrefix = stage === 'prod' ? 'multi-region-dr' : 'multi-region-dr-beta';
    const origin = stage === 'prod' ? SITE_ORIGIN : BETA_SITE_ORIGIN;
    const removalPolicy = cdk.RemovalPolicy.DESTROY;

    // A real deployment would replace this with dynamodb.Table's
    // replicationRegions prop (Global Tables) so both regions read/write
    // the same replicated data -- kept as a single-region table here
    // since this stack is never actually deployed to a second region.
    const failoverStateTable = new dynamodb.Table(this, 'FailoverStateTable', {
      partitionKey: { name: 'stateKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    const functionDefaults: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      code: lambda.Code.fromAsset(BACKEND_DIR),
    };

    const getFailoverStateFunction = new lambda.Function(this, 'GetFailoverStateFunction', {
      ...functionDefaults,
      handler: 'get_failover_state_handler.lambda_handler',
      environment: { TABLE_NAME: failoverStateTable.tableName, ALLOWED_ORIGIN: origin },
    } as lambda.FunctionProps);
    failoverStateTable.grantReadData(getFailoverStateFunction);

    const triggerFailoverFunction = new lambda.Function(this, 'TriggerFailoverFunction', {
      ...functionDefaults,
      handler: 'trigger_failover_handler.lambda_handler',
      environment: { TABLE_NAME: failoverStateTable.tableName, ALLOWED_ORIGIN: origin },
    } as lambda.FunctionProps);
    failoverStateTable.grantReadWriteData(triggerFailoverFunction);

    const failoverApi = new apigwv2.HttpApi(this, 'FailoverApi', {
      apiName: namePrefix,
      corsPreflight: {
        allowOrigins: [origin],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type'],
      },
    });
    failoverApi.addRoutes({
      path: '/failover-state',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('GetFailoverStateIntegration', getFailoverStateFunction),
    });
    failoverApi.addRoutes({
      path: '/failover-state/simulate',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('TriggerFailoverIntegration', triggerFailoverFunction),
    });

    this.apiEndpoint = failoverApi.apiEndpoint;

    // The health check + failover record sets a real deployment would
    // add once this stack existed in both regions -- shown here for one
    // region's PRIMARY side to keep the reference architecture concrete.
    // Not created for beta (a health check against a beta API endpoint
    // that's never actually deployed would just sit permanently
    // unhealthy) -- prod-only, matching how this stack would really be
    // rolled out if it were ever wired in.
    if (stage === 'prod') {
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: HOSTED_ZONE_ID,
        zoneName: HOSTED_ZONE_NAME,
      });

      const healthCheck = new route53.HealthCheck(this, 'PrimaryHealthCheck', {
        type: route53.HealthCheckType.HTTPS,
        fqdn: cdk.Fn.select(2, cdk.Fn.split('/', this.apiEndpoint)),
        resourcePath: '/failover-state',
        requestInterval: cdk.Duration.seconds(30),
        failureThreshold: 3,
      });

      new route53.ARecord(this, 'PrimaryFailoverRecord', {
        zone: hostedZone,
        recordName: 'dr-demo',
        // An HttpApi has no built-in Route53 alias target the way a
        // CloudFront distribution or ALB does, and this record is never
        // actually resolved by anyone -- 192.0.2.1 is the RFC 5737
        // TEST-NET-1 address, reserved specifically for documentation
        // and examples like this one, so it can't collide with a real
        // address if this ever were deployed.
        target: route53.RecordTarget.fromIpAddresses('192.0.2.1'),
        failover: route53.Failover.PRIMARY,
        healthCheck,
        setIdentifier: 'primary',
      });
    }

    new cdk.CfnOutput(this, 'FailoverApiEndpoint', {
      description: 'Value to paste into projects/multi-region-dr/frontend/config.js as apiBase, if this stack is ever wired in',
      value: this.apiEndpoint,
    });
  }
}
