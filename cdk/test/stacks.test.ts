import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AWS_ACCOUNT, AWS_REGION } from '../lib/config';
import { ContactFormStack } from '../lib/contact-form-stack';
import { FanningSnsStack } from '../lib/fanning-sns-stack';
import { LivePollStack } from '../lib/live-poll-stack';
import { HabitTrackerStack } from '../lib/habit-tracker-stack';
import { NovaSummarizerStack } from '../lib/nova-summarizer-stack';
import { WorkflowVisualizerStack } from '../lib/workflow-visualizer-stack';

const env = { account: AWS_ACCOUNT, region: AWS_REGION };
const DEPRECATED = /^(python3\.(7|8|9)|nodejs(10|12|14|16|18)\.x|dotnetcore|ruby2)/;

type Ctor = new (scope: cdk.App, id: string, props: any) => cdk.Stack;
const STACKS: Array<[string, Ctor]> = [
  ['contact-form-api', ContactFormStack], ['fanning-sns', FanningSnsStack], ['live-poll', LivePollStack],
  ['habit-tracker', HabitTrackerStack], ['nova-summarizer', NovaSummarizerStack], ['workflow-visualizer', WorkflowVisualizerStack],
];

function synth(Stack: Ctor, id: string, stage: 'prod' | 'beta'): Template {
  const app = new cdk.App();
  return Template.fromStack(new Stack(app, id, { env, stage }));
}

describe.each(STACKS)('%s', (name, Stack) => {
  describe.each(['prod', 'beta'] as const)('%s stage', (stage) => {
    const t = synth(Stack, stage === 'prod' ? name : `${name}-beta`, stage);

    test('every Lambda runs a supported runtime', () => {
      const fns = Object.values(t.findResources('AWS::Lambda::Function'));
      expect(fns.length).toBeGreaterThan(0);
      for (const f of fns) expect(String((f as any).Properties.Runtime)).not.toMatch(DEPRECATED);
    });

    test('no IAM policy allows every action on every resource', () => {
      const docs = [...Object.values(t.findResources('AWS::IAM::Policy')), ...Object.values(t.findResources('AWS::IAM::Role'))];
      const statements: any[] = [];
      for (const d of docs as any[]) {
        const p = d.Properties;
        if (p.PolicyDocument) statements.push(...[].concat(p.PolicyDocument.Statement));
        for (const inline of p.Policies ?? []) statements.push(...[].concat(inline.PolicyDocument.Statement));
      }
      for (const s of statements) {
        const acts = [].concat(s.Action ?? []), res = [].concat(s.Resource ?? []);
        expect(s.Effect === 'Allow' && acts.includes('*' as never) && res.includes('*' as never)).toBe(false);
      }
    });

    test('no S3 bucket is publicly readable by ACL', () => {
      for (const b of Object.values(t.findResources('AWS::S3::Bucket')) as any[])
        expect(['PublicRead', 'PublicReadWrite']).not.toContain(b.Properties.AccessControl);
    });
  });
});

test('beta and prod of the same project are independent stacks with different Lambda names', () => {
  const names = (t: Template) => Object.values(t.findResources('AWS::Lambda::Function')).map((f: any) => JSON.stringify(f.Properties.FunctionName ?? null)).sort();
  const prod = names(synth(ContactFormStack, 'contact-form-api', 'prod')), beta = names(synth(ContactFormStack, 'contact-form-api-beta', 'beta'));
  expect(prod).not.toEqual(beta);
});
