import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface VpcNetworkDesignStackProps extends cdk.StackProps {
  stage: 'prod' | 'beta';
}

/**
 * Reference-only: a multi-tier VPC (public / private-with-egress /
 * isolated subnets across 2 AZs, one NAT Gateway per AZ) matching the
 * topology documented on projects/vpc-network-design's page and README.
 *
 * This stack is intentionally never instantiated in cdk/bin/portfolio.ts
 * -- a NAT Gateway alone runs ~$35-90/month even fully idle, which isn't
 * justified for a portfolio demo (see the project's README for the full
 * cost breakdown). It exists to be tsc/cdk synth-checked as real,
 * compilable reference code, not dead pseudo-code -- every route table
 * and security group rule shown on the live demo page is exactly what
 * this stack would actually provision, not a simplified stand-in for it.
 *
 * Unlike this portfolio's other backend-having stacks, there's no API or
 * Lambda here at all -- the demo is pure static click-to-inspect, so
 * there's no `apiEndpoint` to expose. cdk/lib/website-content.ts's
 * PROJECTS entry for this project has no `key`, so nothing ever looks
 * one up.
 */
export class VpcNetworkDesignStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: VpcNetworkDesignStackProps) {
    super(scope, id, props);

    const { stage } = props;
    const namePrefix = stage === 'prod' ? 'vpc-network-design' : 'vpc-network-design-beta';

    // Explicit subnetConfiguration, not CDK's implicit default layout --
    // the three tiers and their exact CIDR carve-out need to be legible
    // on their own, not just "whatever ec2.Vpc happens to produce".
    this.vpc = new ec2.Vpc(this, 'DemoVpc', {
      vpcName: namePrefix,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 2, // one per AZ -- see the project README's cost/design-decisions section for why not 1 shared gateway
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // --- Tier-to-tier security groups, referenced by group id rather
    // than by CIDR block, matching the rules shown on the demo page. ---
    const webSg = new ec2.SecurityGroup(this, 'WebSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `${namePrefix}-web-sg`,
      description: 'Public-facing web tier',
      allowAllOutbound: false,
    });
    webSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS from anywhere');
    webSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from anywhere');

    const appSg = new ec2.SecurityGroup(this, 'AppSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `${namePrefix}-app-sg`,
      description: 'Private application tier, reachable only from the web tier',
      allowAllOutbound: false,
    });
    appSg.addIngressRule(webSg, ec2.Port.tcp(8080), 'App traffic from the web tier only');
    webSg.addEgressRule(appSg, ec2.Port.tcp(8080), 'Web tier can reach the app tier');

    const dbSg = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `${namePrefix}-db-sg`,
      description: 'Isolated database tier, reachable only from the app tier',
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(appSg, ec2.Port.tcp(5432), 'PostgreSQL from the app tier only');
    appSg.addEgressRule(dbSg, ec2.Port.tcp(5432), 'App tier can reach the database tier');
  }
}
