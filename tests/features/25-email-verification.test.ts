import { describe, expect, test } from "vitest";
import { Match } from "aws-cdk-lib/assertions";
import { getStackTemplate } from "../helpers/cdk-template.js";

const template = getStackTemplate();

describe("Feature: Email Verification and Password Recovery", () => {
  test("Cognito user pool auto-verifies email (so verification email is sent on sign-up)", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AutoVerifiedAttributes: ["email"],
    });
  });

  test("Cognito user pool uses email as the recovery channel", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AccountRecoverySetting: Match.objectLike({
        RecoveryMechanisms: Match.arrayWith([
          Match.objectLike({ Name: "verified_email" }),
        ]),
      }),
    });
  });

  test.skip(
    "Receive a verification email and confirm: requires real SES + email inbox; covered indirectly by Cognito's AutoVerifiedAttributes",
    () => {},
  );
  test.skip(
    "Receive and complete a password recovery email: requires real SES + email inbox",
    () => {},
  );
});
