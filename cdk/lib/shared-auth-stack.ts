import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { SES_FROM_ADDRESS, HOSTED_ZONE_NAME } from './config';

export interface SharedAuthStackProps extends cdk.StackProps {
  stage: 'prod' | 'beta';
}

/**
 * One Cognito user pool shared by website-chatbot and moderated-image-
 * gallery, so a single account signs in to both -- each project used to
 * provision its own pool, deliberately kept separate, until sharing login
 * across the two was explicitly requested. Both consuming stacks import
 * this pool and its one app client as props rather than creating their
 * own, so this stack is a real dependency of both: destroying it breaks
 * sign-in on both projects for that stage.
 *
 * Neither project holds anything a visitor couldn't just re-ask for, so
 * this pool is genuinely destroyable like the two it replaces -- no
 * pre-existing accounts in either old pool carry over automatically;
 * anyone who signed up under the old per-project pools needs to sign up
 * again here.
 */
export class SharedAuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string, props: SharedAuthStackProps) {
    super(scope, id, props);

    const removalPolicy = cdk.RemovalPolicy.DESTROY;

    this.userPool = new cognito.UserPool(this, 'UserPool', {
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
      // SES_FROM_ADDRESS is already a verified SES identity in this
      // account (the contact-form and SNS-fan-out projects send real
      // mail from it) -- reusing it here just replaces Cognito's default
      // no-reply@verificationemail.com sender for verification/invite
      // emails, same domain as every other email this site sends.
      email: cognito.UserPoolEmail.withSES({
        fromEmail: SES_FROM_ADDRESS,
        sesVerifiedDomain: HOSTED_ZONE_NAME,
      }),
      removalPolicy,
    });
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      generateSecret: false,
      authFlows: { userPassword: true },
    });
    this.userPoolId = this.userPool.userPoolId;
    this.userPoolClientId = this.userPoolClient.userPoolClientId;

    new cdk.CfnOutput(this, 'CognitoUserPoolId', { value: this.userPoolId });
    new cdk.CfnOutput(this, 'CognitoUserPoolClientId', { value: this.userPoolClientId });
  }
}
