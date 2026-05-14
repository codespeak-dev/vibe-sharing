import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { VibeShareStack } from "../../backend/lib/vibe-share-stack.js";

let cached: Template | undefined;

/** Synthesize the stack once per test process and return its Template. */
export function getStackTemplate(): Template {
  if (cached) return cached;
  const app = new cdk.App();
  const stack = new VibeShareStack(app, "TestStack", {
    env: { account: "111111111111", region: "eu-north-1" },
  });
  cached = Template.fromStack(stack);
  return cached;
}
