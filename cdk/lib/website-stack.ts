import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as iam from 'aws-cdk-lib/aws-iam';
import { HOSTED_ZONE_ID, HOSTED_ZONE_NAME } from './config';
import { buildWebsiteContentDir } from './website-content';

export interface WebsiteStackProps extends cdk.StackProps {
  /** Human label only ("prod" | "beta") -- not used to derive any resource name. */
  stage: string;
  domainName: string;
  bucketName: string;
  certificateArn: string;
  comment: string;
  /** Live prod returns /index.html (SPA-style) for both 403 and 404; live beta has none configured. */
  customErrorResponses?: cloudfront.CfnDistribution.CustomErrorResponseProperty[];
  /** Prod's Route 53 apex only has an A alias today; beta has both A and AAAA. */
  createAaaaRecord: boolean;
  /** False while this stack's existing resources are still being imported. */
  manageContent: boolean;
  /** ARN of an existing WAFv2 WebACL already attached to this distribution, if any. */
  webAclId?: string;
}

/**
 * Adopts one of the two hand-built static-site environments (S3 bucket +
 * CloudFront distribution + Route 53 alias records) as-is via `cdk import`,
 * then takes over deploying content to it via BucketDeployment -- this is
 * what replaces the manual `aws s3 sync` + `aws cloudfront
 * create-invalidation` workflow FolderStructure/ existed to support.
 */
export class WebsiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebsiteStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: props.bucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const oac = new cloudfront.CfnOriginAccessControl(this, 'OriginAccessControl', {
      originAccessControlConfig: {
        name: `${props.bucketName}-oac`,
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });
    oac.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    const originId = `${bucket.bucketRegionalDomainName}-origin`;
    const distribution = new cloudfront.CfnDistribution(this, 'Distribution', {
      distributionConfig: {
        enabled: true,
        comment: props.comment,
        defaultRootObject: 'index.html',
        priceClass: 'PriceClass_All',
        httpVersion: 'http2',
        ipv6Enabled: true,
        aliases: [props.domainName],
        origins: [
          {
            id: originId,
            domainName: bucket.bucketRegionalDomainName,
            originAccessControlId: oac.attrId,
            s3OriginConfig: { originAccessIdentity: '' },
          },
        ],
        defaultCacheBehavior: {
          targetOriginId: originId,
          viewerProtocolPolicy: 'redirect-to-https',
          allowedMethods: ['GET', 'HEAD'],
          cachedMethods: ['GET', 'HEAD'],
          compress: true,
          // Managed-CachingOptimized
          cachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6',
        },
        customErrorResponses: props.customErrorResponses,
        webAclId: props.webAclId,
        viewerCertificate: {
          acmCertificateArn: props.certificateArn,
          sslSupportMethod: 'sni-only',
          minimumProtocolVersion: 'TLSv1.2_2021',
        },
      },
    });
    distribution.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontServicePrincipal',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [bucket.arnForObjects('*')],
        conditions: {
          ArnLike: {
            'AWS:SourceArn': this.formatArn({
              service: 'cloudfront',
              region: '',
              resource: 'distribution',
              resourceName: distribution.attrId,
            }),
          },
        },
      }),
    );

    // AWS::Route53::RecordSet is not a CloudFormation-importable resource
    // type at all, so like BucketDeployment below, the alias record(s) are
    // only added in the follow-up plain `cdk deploy`. Route53 record
    // resources are always applied as an UPSERT by CloudFormation, so
    // creating one that happens to match an already-existing record just
    // takes it over in place -- no import mechanism needed, no downtime.
    if (props.manageContent) {
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: HOSTED_ZONE_ID,
        zoneName: HOSTED_ZONE_NAME,
      });
      const aliasTarget = route53.RecordTarget.fromAlias({
        bind: () => ({
          dnsName: distribution.attrDomainName,
          hostedZoneId: 'Z2FDTNDATAQYW2', // fixed CloudFront alias-target hosted zone id
        }),
      });
      new route53.ARecord(this, 'AliasRecordA', {
        zone: hostedZone,
        recordName: props.domainName,
        target: aliasTarget,
      });
      if (props.createAaaaRecord) {
        new route53.AaaaRecord(this, 'AliasRecordAAAA', {
          zone: hostedZone,
          recordName: props.domainName,
          target: aliasTarget,
        });
      }
    }

    // Added in the same follow-up plain `cdk deploy` -- BucketDeployment
    // creates its own supporting Lambda/role/log group, which are genuinely
    // new resources and can't be mixed into a `cdk import` changeset
    // alongside the adopted ones.
    if (props.manageContent) {
      new s3deploy.BucketDeployment(this, 'DeployWebsiteContent', {
        sources: [s3deploy.Source.asset(buildWebsiteContentDir())],
        destinationBucket: bucket,
        distribution: cloudfront.Distribution.fromDistributionAttributes(this, 'ImportedDistribution', {
          distributionId: distribution.attrId,
          domainName: distribution.attrDomainName,
        }),
        distributionPaths: ['/*'],
        prune: true,
      });
    }

    new cdk.CfnOutput(this, 'DistributionDomainName', { value: distribution.attrDomainName });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.attrId });
  }
}
