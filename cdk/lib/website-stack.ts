import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as iam from 'aws-cdk-lib/aws-iam';
import { HOSTED_ZONE_ID, HOSTED_ZONE_NAME } from './config';
import { buildWebsiteContentDir, buildConfigJsSources, Stage, ProjectKey } from './website-content';

export interface WebsiteStackProps extends cdk.StackProps {
  stage: Stage;
  domainName: string;
  bucketName: string;
  certificateArn: string;
  comment: string;
  /** Both prod and beta return /index.html (SPA-style) for 403 and 404 -- beta was missing this from the original import (its distribution had none configured live), which meant an unmatched path fell through to a raw S3 AccessDenied XML error instead of the site. */
  customErrorResponses?: cloudfront.CfnDistribution.CustomErrorResponseProperty[];
  /** Prod's Route 53 apex only has an A alias today; beta has both A and AAAA. */
  createAaaaRecord: boolean;
  /** False while this stack's existing resources are still being imported. */
  manageContent: boolean;
  /** ARN of an existing WAFv2 WebACL already attached to this distribution, if any. */
  webAclId?: string;
  /**
   * This stage's actual backend API endpoints, one per project -- each a
   * CDK-token-bearing string from that stage's own backend stack (e.g.
   * `fanningSnsStack.apiEndpoint`), never a literal URL. Used to generate
   * each project's config.js at deploy time; see buildConfigJsSources() in
   * website-content.ts for why this can't be a plain static file copy.
   */
  apiEndpoints: Record<ProjectKey, string>;
  /** Non-endpoint per-project config.js tokens (e.g. Cognito ids) for this stage. See buildConfigJsSources(). */
  extraConfigReplacements?: Partial<Record<ProjectKey, Record<string, string>>>;
  /**
   * Optional extra hostname (e.g. www.mcginnisarchitecture.com) that should
   * 301-redirect to domainName instead of serving its own copy of the site.
   * certificateArn must already cover it (the wildcard cert, typically) --
   * this never requests or replaces a cert, same rule as everywhere else in
   * this file.
   */
  wwwRedirect?: {
    domainName: string;
    certificateArn: string;
  };
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

    // A second, independent distribution rather than a second alias on the
    // one above: CloudFront allows exactly one cert per distribution
    // covering every alias on it, and domainName's cert (see config.ts) is
    // never touched/replaced to add a SAN. wwwRedirect.certificateArn (the
    // wildcard cert) already covers this hostname on its own, so this needs
    // its own distribution rather than widening the primary one.
    //
    // Origin points at the same bucket as the primary distribution above,
    // but deliberately isn't granted any access to it -- the function below
    // returns a redirect for every request at viewer-request, before
    // CloudFront ever looks at the origin, so it's only here because
    // CloudFront requires *an* origin to exist. If the function ever somehow
    // didn't fire, the fallback is a bare S3 AccessDenied, never real
    // content served from an unintended hostname.
    let wwwDistribution: cloudfront.CfnDistribution | undefined;
    if (props.wwwRedirect) {
      const wwwRedirect = props.wwwRedirect;
      const wwwFunctionName = `${wwwRedirect.domainName.replace(/\./g, '-')}-redirect`;
      const wwwRedirectFunction = new cloudfront.CfnFunction(this, 'WwwRedirectFunction', {
        name: wwwFunctionName,
        autoPublish: true,
        functionConfig: {
          comment: `Redirect ${wwwRedirect.domainName} to https://${props.domainName}`,
          runtime: 'cloudfront-js-2.0',
        },
        functionCode: `
function handler(event) {
    var request = event.request;
    var host = request.headers.host.value;
    if (host === '${wwwRedirect.domainName}') {
        var qsKeys = Object.keys(request.querystring);
        var qs = qsKeys.length
            ? '?' + qsKeys.map(function (k) { return k + '=' + request.querystring[k].value; }).join('&')
            : '';
        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                location: { value: 'https://${props.domainName}' + request.uri + qs }
            }
        };
    }
    return request;
}
`,
      });

      wwwDistribution = new cloudfront.CfnDistribution(this, 'WwwRedirectDistribution', {
        distributionConfig: {
          enabled: true,
          comment: `${props.comment} (${wwwRedirect.domainName} redirect)`,
          httpVersion: 'http2',
          ipv6Enabled: true,
          aliases: [wwwRedirect.domainName],
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
            cachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', // Managed-CachingOptimized
            functionAssociations: [{ eventType: 'viewer-request', functionArn: wwwRedirectFunction.attrFunctionArn }],
          },
          viewerCertificate: {
            acmCertificateArn: wwwRedirect.certificateArn,
            sslSupportMethod: 'sni-only',
            minimumProtocolVersion: 'TLSv1.2_2021',
          },
        },
      });

      new cdk.CfnOutput(this, 'WwwDistributionDomainName', { value: wwwDistribution.attrDomainName });
      new cdk.CfnOutput(this, 'WwwDistributionId', { value: wwwDistribution.attrId });
    }

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

      if (props.wwwRedirect && wwwDistribution) {
        const wwwAliasTarget = route53.RecordTarget.fromAlias({
          bind: () => ({
            dnsName: wwwDistribution!.attrDomainName,
            hostedZoneId: 'Z2FDTNDATAQYW2', // fixed CloudFront alias-target hosted zone id
          }),
        });
        new route53.ARecord(this, 'WwwAliasRecordA', {
          zone: hostedZone,
          recordName: props.wwwRedirect.domainName,
          target: wwwAliasTarget,
        });
        new route53.AaaaRecord(this, 'WwwAliasRecordAAAA', {
          zone: hostedZone,
          recordName: props.wwwRedirect.domainName,
          target: wwwAliasTarget,
        });
      }
    }

    // Added in the same follow-up plain `cdk deploy` -- BucketDeployment
    // creates its own supporting Lambda/role/log group, which are genuinely
    // new resources and can't be mixed into a `cdk import` changeset
    // alongside the adopted ones.
    if (props.manageContent) {
      const configJsSources = buildConfigJsSources(props.stage, props.apiEndpoints, props.extraConfigReplacements).map(
        ({ destinationKey, content }) => s3deploy.Source.data(destinationKey, content),
      );

      new s3deploy.BucketDeployment(this, 'DeployWebsiteContent', {
        sources: [s3deploy.Source.asset(buildWebsiteContentDir(props.stage)), ...configJsSources],
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
