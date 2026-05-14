import { describe, expect, test } from "vitest";
import { getStackTemplate } from "../helpers/cdk-template.js";

const template = getStackTemplate();

describe("Feature: CDK Deployment Fixes", () => {
  test("Alarm email stays in config (non-sensitive); Slack webhook stays in SSM (sensitive)", () => {
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "a+alarms@codespeak.dev",
    });
    const policies = template.findResources("AWS::IAM::Policy");
    const grantsSsm = Object.values(policies).some((p) =>
      JSON.stringify(p.Properties.PolicyDocument).includes("ssm:GetParameter"),
    );
    expect(grantsSsm).toBe(true);
  });
});
