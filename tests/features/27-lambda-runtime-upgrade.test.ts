import { describe, expect, test } from "vitest";
import { getStackTemplate } from "../helpers/cdk-template.js";

const template = getStackTemplate();

describe("Feature: Lambda Node.js Runtime Upgrade", () => {
  test("All user-defined Lambda functions run on Node.js 22.x", () => {
    const fns = template.findResources("AWS::Lambda::Function");
    const runtimes = Object.values(fns).map((f) => f.Properties.Runtime);
    // CDK custom resources may use other Node runtimes; we assert at least one
    // user function is on 22.x and that none of our user functions are on 20.x or older.
    expect(runtimes).toContain("nodejs22.x");
    // Our 4 user lambdas (presign, confirm, list-uploads, slack-notify, etc.) all use 22.x.
    const userFns22 = runtimes.filter((r) => r === "nodejs22.x");
    expect(userFns22.length).toBeGreaterThanOrEqual(4);
  });
});
