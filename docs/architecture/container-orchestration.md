# Container Orchestration — Architecture

Companion guide for `container-orchestration.drawio`.

**Reference architecture only.** Reflects `cdk/lib/container-orchestration-stack.ts`,
which is real, `cdk synth`-checked, compilable code — but it is deliberately **never
instantiated** in `cdk/bin/portfolio.ts`. An ECS/Fargate service, its ALB, and its NAT
gateway run roughly $75–200/month even fully idle (the ALB and NAT Gateway are flat
hourly charges regardless of traffic), so this stack stays undeployed to control cost.
The homepage labels this project "Reference build," not "Live."

## Flow

1. A small VPC (2 AZs, a single NAT Gateway — enough to demonstrate multi-AZ placement
   without paying for a second NAT Gateway) hosts an ECS cluster.
2. `ApplicationLoadBalancedFargateService` bundles the task definition, Fargate
   service, and an internet-facing **Application Load Balancer** into one construct —
   a public sample image (`nginx`) stands in for a real app image, since there's
   nothing to deploy.
3. The service uses ECS's native **rolling-update deployment controller**
   (`minHealthyPercent: 100`, `maxHealthyPercent: 200`, plus a deployment circuit
   breaker with rollback) rather than CodeDeploy blue/green — this is ECS's default,
   simplest deployment story, and matches what the frontend demo actually depicts:
   tasks flipping one at a time, not a full traffic cutover between two environments.
4. A small status API — `DeploymentStatusFunction` (`ecs:DescribeServices`) and
   `TriggerDeploymentFunction` (`ecs:UpdateService`) — lets a frontend poll or kick off
   a rolling deployment **without needing ECS IAM permissions of its own**. Both
   Lambdas are scoped to this one service's ARN, not a wildcard.
5. **CloudWatch Container Insights** is enabled on the cluster for the "Logs / Metrics"
   path shown in the diagram.

## Services

| Service | Role |
|---|---|
| Amazon VPC | 2-AZ network with a single NAT Gateway |
| Amazon ECS (Fargate) | The service itself, behind an ALB, 4 desired tasks |
| Application Load Balancer | Routes traffic to the Fargate service |
| AWS Lambda | Status-poll and trigger-deployment API, scoped to `ecs:DescribeServices`/`UpdateService` on this service only |
| Amazon API Gateway | HTTP API fronting the two status Lambdas |
| Amazon CloudWatch | Container Insights for cluster/service metrics |

## Key design decisions

- **Never deployed, by design.** This stays a compilable reference — the cost of an
  always-on ALB + NAT Gateway isn't justified by a rolling-deployment demo that a
  scheduled Lambda simulation (see the other reference projects) can show just as
  well for free.
- **Rolling update, not blue/green.** A CodeDeploy `EcsDeploymentGroup` could sit on
  top of this same service for a blue/green story, but that needs two target groups
  and an extra listener — complexity the current demo doesn't need.
- **The status API never touches ECS IAM directly from the frontend.** Two Lambdas,
  each scoped to one action on one service ARN, mediate every ECS call.
