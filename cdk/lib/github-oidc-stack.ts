import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

const GITHUB_OIDC_THUMBPRINT_URL = 'https://token.actions.githubusercontent.com';

export interface GitHubOidcStackProps extends cdk.StackProps {
  /** e.g. "CelebornMcGinnis/AWS-Certified-Solutions-Architect-Associate-Project-Portfolio" */
  githubRepo: string;
}

/**
 * Lets GitHub Actions work with this CDK app without any long-lived AWS
 * keys. Two roles, scoped to what each workflow actually needs:
 *
 * - GitHubActionsDeployRole: only assumable by the push-to-main workflow.
 *   Can assume this account's deploy/file-publishing/lookup bootstrap
 *   roles -- the same roles any `cdk deploy` already relies on, not direct
 *   CloudFormation/S3/Lambda admin access.
 * - GitHubActionsPlanRole: assumable by pull_request workflows too, but can
 *   only assume the read-only lookup-role -- enough for `cdk diff`/`cdk
 *   synth` to inspect live stacks, not enough to change anything, so a PR
 *   workflow can never deploy even if its own YAML said to.
 */
export class GitHubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: GitHubOidcStackProps) {
    super(scope, id, props);

    const provider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: GITHUB_OIDC_THUMBPRINT_URL,
      clientIds: ['sts.amazonaws.com'],
    });

    const bootstrapRoleArn = (role: string) =>
      this.formatArn({
        service: 'iam',
        region: '',
        resource: 'role',
        resourceName: `cdk-hnb659fds-${role}-${this.account}-${this.region}`,
      });

    const deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      roleName: 'github-actions-portfolio-cdk-deploy',
      description: 'Assumed by the push-to-main GitHub Actions workflow to deploy the portfolio CDK app',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:ref:refs/heads/main`,
        },
      }),
    });
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [
          bootstrapRoleArn('deploy-role'),
          bootstrapRoleArn('file-publishing-role'),
          bootstrapRoleArn('lookup-role'),
        ],
      }),
    );

    const planRole = new iam.Role(this, 'GitHubActionsPlanRole', {
      roleName: 'github-actions-portfolio-cdk-plan',
      description: 'Assumed by pull-request GitHub Actions workflows to run read-only cdk diff/synth',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:pull_request`,
        },
      }),
    });
    planRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [bootstrapRoleArn('lookup-role')],
      }),
    );

    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new cdk.CfnOutput(this, 'PlanRoleArn', { value: planRole.roleArn });
  }
}
