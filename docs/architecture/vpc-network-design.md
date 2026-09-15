# VPC Network Design — Architecture

Companion guide for `vpc-network-design.drawio`.

**Reference architecture only.** Reflects `cdk/lib/vpc-network-design-stack.ts`, which
is real, `cdk synth`-checked, compilable code — but it is deliberately **never
instantiated** in `cdk/bin/portfolio.ts`. A NAT Gateway alone runs ~$35–90/month even
fully idle, which isn't justified for a portfolio demo. Every route table and security
group rule shown on the live demo page is exactly what this stack would actually
provision, not a simplified stand-in for it.

## What the code actually provisions vs. what the diagram shows

**There is no EC2 or RDS in this stack at all.** It provisions the VPC, its three
subnet tiers, and tier-to-tier security groups only — no compute, no database. The
diagram's EC2/RDS icons illustrate what would typically *sit inside* each tier's
security group, not resources this stack itself creates. Unlike this portfolio's other
backend-having projects, there's no API or Lambda here either — the demo is a pure
static, click-to-inspect page, so there's no `apiEndpoint` to expose.

## Flow

1. A single VPC (`10.0.0.0/16`, 2 AZs) uses **explicit** `subnetConfiguration` — not
   CDK's implicit default layout — so the three tiers and their CIDR carve-outs are
   legible on their own: `public` (`ec2.SubnetType.PUBLIC`), `private`
   (`PRIVATE_WITH_EGRESS`), and `isolated` (`PRIVATE_ISOLATED`), each a `/24`.
2. **Two NAT Gateways** — one per AZ, not a single shared gateway — so a private-tier
   resource's outbound path never crosses an AZ boundary.
3. Three security groups gate traffic **by security-group reference, not CIDR block**:
   the web tier allows inbound 80/443 from anywhere; the app tier allows inbound 8080
   only from the web tier's security group; the database tier allows inbound 5432 only
   from the app tier's security group. Each also has a matching, explicit egress rule
   (`allowAllOutbound: false` on all three) — traffic is denied by default in both
   directions except where a rule says otherwise.

## Services

| Service | Role |
|---|---|
| Amazon VPC | 2-AZ network with public/private/isolated subnet tiers |
| Amazon EC2 (NAT Gateway) | One per AZ, egress-only for the private tier |
| Security Groups | Reference-based tier isolation (web→app→db), not CIDR-based |

## Key design decisions

- **Never deployed, by design** — the NAT Gateways' always-on cost is what this demo
  avoids, not the VPC/subnet/security-group resources themselves (which are free).
- **Security-group references, not CIDR ranges.** Each tier's ingress rule names the
  upstream tier's security group directly, so the rule stays correct even if subnet
  CIDRs ever changed.
- **Two NAT Gateways, not one shared.** Keeps each AZ's private-subnet egress path
  independent — see the project README's cost/design-decisions section for the full
  reasoning.
- **No compute or database resources exist in this stack.** It's purely the network
  layer a real 3-tier app would be deployed into.
