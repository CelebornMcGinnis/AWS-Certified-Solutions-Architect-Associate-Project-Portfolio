import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { SITE_ORIGIN, BETA_SITE_ORIGIN } from './config';

const BACKEND_DIR = path.join(__dirname, '../../projects/website-chatbot/backend');

export interface WebsiteChatbotStackProps extends cdk.StackProps {
  stage: 'prod' | 'beta';
}

/**
 * Cognito-protected site chatbot: a small deterministic FAQ layer
 * answers what it can; anything else goes to Bedrock's Nova Lite model
 * through a Bedrock Guardrail, and the response always says which path
 * answered ("faq", "ai", or "guardrail" if the guardrail itself blocked
 * the request) so the UI never pretends every answer came from the
 * same place. The browser never talks to Bedrock directly -- every
 * call goes through ChatFunction, which is the only thing holding
 * Bedrock permissions.
 *
 * Conversation history is genuinely short-lived: every message carries
 * a DynamoDB TTL (24 hours), not a manual cleanup job.
 *
 * Same isolated-per-project auth pattern as moderated-image-gallery --
 * its own Cognito user pool, not shared with that project's.
 */
export class WebsiteChatbotStack extends cdk.Stack {
  public readonly apiEndpoint: string;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string, props: WebsiteChatbotStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const origin = stage === 'prod' ? SITE_ORIGIN : BETA_SITE_ORIGIN;
    // Neither stage holds anything a visitor couldn't just re-ask --
    // both tear down completely, same as this site's other projects
    // that never had pre-existing real data to protect.
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
      generateSecret: false,
      authFlows: { userPassword: true },
    });
    this.userPoolId = userPool.userPoolId;
    this.userPoolClientId = userPoolClient.userPoolClientId;

    // --- Storage ---
    // One item per message (both the visitor's and the assistant's),
    // partitioned by owner so OwnerIndex-style per-user isolation is
    // just the table's own primary key here -- no GSI needed, since
    // "this user's conversation" is the only access pattern this
    // project has.
    const conversationsTable = new dynamodb.Table(this, 'ConversationsTable', {
      partitionKey: { name: 'ownerSub', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy,
    });

    // --- Guardrail ---
    // Content filters cover the standard harm categories; the one
    // denied topic (financial/investment advice) is deliberately easy
    // and safe to demo -- "what stock should I buy?" visibly gets
    // blocked, without needing to type anything actually offensive to
    // prove the content filters exist.
    const guardrail = new bedrock.CfnGuardrail(this, 'ChatGuardrail', {
      name: stage === 'prod' ? 'website-chatbot-guardrail' : 'website-chatbot-guardrail-beta',
      description: 'Guardrail for the website chatbot demo -- standard content filters plus one denied topic.',
      blockedInputMessaging: "I can't help with that request.",
      blockedOutputsMessaging: "I can't help with that request.",
      contentPolicyConfig: {
        filtersConfig: [
          { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
          { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
          { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' },
        ],
      },
      topicPolicyConfig: {
        topicsConfig: [
          {
            name: 'FinancialAdvice',
            type: 'DENY',
            definition: 'Requests for personalized financial, investment, tax, or trading advice.',
            examples: ['What stock should I buy?', 'Should I invest my savings in crypto?'],
          },
        ],
      },
    });
    // No separate CfnGuardrailVersion resource -- this demo invokes the
    // guardrail's DRAFT version directly, which Bedrock supports for
    // exactly this kind of use, rather than publishing a numbered
    // version purely to satisfy a production practice this project
    // doesn't need.
    const guardrailVersion = 'DRAFT';

    // --- Lambdas ---
    const functionDefaults: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(15), // Bedrock inference can take a few seconds
      memorySize: 128,
      code: lambda.Code.fromAsset(BACKEND_DIR),
      environment: {
        TABLE_NAME: conversationsTable.tableName,
        ALLOWED_ORIGIN: origin,
      },
    };

    const chatFunction = new lambda.Function(this, 'ChatFunction', {
      ...functionDefaults,
      handler: 'chat_handler.lambda_handler',
      environment: {
        ...functionDefaults.environment,
        BEDROCK_MODEL_ID: 'us.amazon.nova-lite-v1:0',
        GUARDRAIL_ID: guardrail.attrGuardrailId,
        GUARDRAIL_VERSION: guardrailVersion,
      },
    } as lambda.FunctionProps);
    conversationsTable.grantReadWriteData(chatFunction);
    chatFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:ApplyGuardrail'],
        resources: ['*'],
      }),
    );

    const historyFunction = new lambda.Function(this, 'HistoryFunction', {
      ...functionDefaults,
      handler: 'get_history_handler.lambda_handler',
    } as lambda.FunctionProps);
    conversationsTable.grantReadData(historyFunction);

    // --- API ---
    const authorizer = new HttpUserPoolAuthorizer('ChatAuthorizer', userPool, {
      userPoolClients: [userPoolClient],
    });

    const api = new apigwv2.HttpApi(this, 'ChatApi', {
      apiName: stage === 'prod' ? 'website-chatbot' : 'website-chatbot-beta',
      corsPreflight: {
        allowOrigins: [origin],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    api.addRoutes({
      path: '/chat',
      methods: [apigwv2.HttpMethod.POST],
      integration: new HttpLambdaIntegration('ChatIntegration', chatFunction),
      authorizer,
    });
    api.addRoutes({
      path: '/chat/history',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('HistoryIntegration', historyFunction),
      authorizer,
    });

    this.apiEndpoint = api.apiEndpoint;

    new cdk.CfnOutput(this, 'ChatApiEndpoint', {
      description: 'Value to paste into projects/website-chatbot/frontend/config.js as apiBase',
      value: this.apiEndpoint,
    });
    new cdk.CfnOutput(this, 'CognitoUserPoolId', { value: this.userPoolId });
    new cdk.CfnOutput(this, 'CognitoUserPoolClientId', { value: this.userPoolClientId });
  }
}
