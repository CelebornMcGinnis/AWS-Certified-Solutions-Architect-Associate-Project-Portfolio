import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { SITE_ORIGIN, BETA_SITE_ORIGIN } from './config';

const BACKEND_DIR = path.join(__dirname, '../../projects/container-orchestration/backend');

export interface ContainerOrchestrationStackProps extends cdk.StackProps {
  stage: 'prod' | 'beta';
}

/**
 * Reference architecture only -- intentionally NEVER instantiated in
 * cdk/bin/portfolio.ts. An ECS/Fargate service, its Application Load
 * Balancer, and its NAT gateway run ~$75-200/month even fully idle (the
 * ALB and NAT Gateway are flat hourly charges regardless of traffic), so
 * this stays undeployed to control cost -- see the project's README for
 * the full rationale. This file exists to be tsc/`cdk synth`-checked as
 * real, compilable reference code, not dead pseudo-code: it's exercised
 * by `npm run build` even though nothing ever calls `new
 * ContainerOrchestrationStack(...)`.
 *
 * Container orchestration demo: an ECS Fargate service behind an ALB,
 * fronted by a small status API two Lambdas expose so a frontend could
 * poll "how's the rolling deployment going" without needing ECS IAM
 * permissions of its own. Uses ECS's native rolling-update deployment
 * controller (minHealthyPercent/maxHealthyPercent + a deployment circuit
 * breaker) rather than CodeDeploy blue/green -- rolling update is ECS's
 * default and simplest deployment story and is what the frontend demo
 * actually depicts (tasks flipping one at a time, not a full traffic
 * cutover between two parallel environments). A CodeDeploy
 * EcsDeploymentGroup could sit on top of this same service for a
 * blue/green story later; it's deliberately left out here since it
 * requires two target groups and an extra listener that would add
 * complexity without changing what the demo shows.
 */
export class ContainerOrchestrationStack extends cdk.Stack {
  public readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: ContainerOrchestrationStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const namePrefix = stage === 'prod' ? 'container-orchestration' : 'container-orchestration-beta';
    const origin = stage === 'prod' ? SITE_ORIGIN : BETA_SITE_ORIGIN;

    // A small, single-NAT-gateway VPC -- 2 AZs is enough to demonstrate
    // multi-AZ placement without paying for a second NAT gateway.
    const vpc = new ec2.Vpc(this, 'ServiceVpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: namePrefix,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    // ApplicationLoadBalancedFargateService bundles the task definition,
    // Fargate service, and internet-facing ALB in one L3 construct --
    // exactly the shape a real "container behind a load balancer" demo
    // needs, without hand-wiring each piece separately.
    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      serviceName: namePrefix,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 4,
      taskImageOptions: {
        // A public sample image stands in for this portfolio's own
        // container image -- there's no real app image to build for a
        // stack that's never deployed.
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/nginx/nginx:latest'),
        containerPort: 80,
      },
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    // --- Status API Lambdas ---
    const functionDefaults: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      code: lambda.Code.fromAsset(BACKEND_DIR),
      environment: {
        CLUSTER_NAME: cluster.clusterName,
        SERVICE_NAME: service.service.serviceName,
        ALLOWED_ORIGIN: origin,
      },
    };

    const deploymentStatusFunction = new lambda.Function(this, 'DeploymentStatusFunction', {
      ...functionDefaults,
      handler: 'deployment_status_handler.lambda_handler',
    } as lambda.FunctionProps);
    deploymentStatusFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ecs:DescribeServices'],
        resources: [service.service.serviceArn],
      }),
    );

    const triggerDeploymentFunction = new lambda.Function(this, 'TriggerDeploymentFunction', {
      ...functionDefaults,
      handler: 'trigger_deployment_handler.lambda_handler',
    } as lambda.FunctionProps);
    triggerDeploymentFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ecs:UpdateService'],
        resources: [service.service.serviceArn],
      }),
    );

    // --- API ---
    const deploymentApi = new apigwv2.HttpApi(this, 'DeploymentApi', {
      apiName: namePrefix,
      corsPreflight: {
        allowOrigins: [origin],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type'],
      },
    });
    deploymentApi.addRoutes({
      path: '/deployment/status',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('DeploymentStatusIntegration', deploymentStatusFunction),
    });
    deploymentApi.addRoutes({
      path: '/deployment/trigger',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('TriggerDeploymentIntegration', triggerDeploymentFunction),
    });

    this.apiEndpoint = deploymentApi.apiEndpoint;

    new cdk.CfnOutput(this, 'DeploymentApiEndpoint', {
      description: 'Value to paste into projects/container-orchestration/frontend/config.js as apiBase, if this were ever deployed',
      value: this.apiEndpoint,
    });
  }
}
