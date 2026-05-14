/**
 * Feature 17 has both CDK-level and browser-level scenarios.
 *  - CDK-level (Cognito user pool config, JWT authorizer, CloudFront distribution)
 *    is asserted in tests below.
 *  - Browser-level scenarios (login redirect, list rendering, repo URL formatting)
 *    are covered by tests/playwright/17-web-ui-auth.spec.ts (run with `npm run test:e2e`).
 */
import { describe, test } from "vitest";
import { Match } from "aws-cdk-lib/assertions";
import { getStackTemplate } from "../helpers/cdk-template.js";

const template = getStackTemplate();

describe("Feature: Web UI — File Browsing and Authentication (CDK level)", () => {
  test("Cognito user pool exists with self-signup and email auto-verify", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AutoVerifiedAttributes: ["email"],
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
    });
  });

  test("Cognito user pool client uses authorization code grant with required scopes and callback URLs", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AllowedOAuthFlows: Match.arrayWith(["code"]),
      AllowedOAuthScopes: Match.arrayWith(["openid", "email", "profile"]),
      CallbackURLs: Match.arrayWith([
        "https://admin.vibe-share.codespeak.dev/callback.html",
      ]),
    });
  });

  test("Pre-sign-up trigger Lambda is registered on the user pool", () => {
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      LambdaConfig: Match.objectLike({ PreSignUp: Match.anyValue() }),
    });
  });

  test("List uploads endpoint is gated by a JWT authorizer", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /api/v1/uploads",
      AuthorizationType: "JWT",
    });
  });

  test("CloudFront distribution exists for the admin UI custom domain", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        Aliases: Match.arrayWith(["admin.vibe-share.codespeak.dev"]),
      }),
    });
  });

  // ─── Browser-level scenarios live in tests/playwright/17-web-ui-auth.spec.ts ───
  // Tracked here so the BDD scenario list is exhaustive.

  test.skip("Authenticate before accessing uploaded files: see playwright spec");
  test.skip("Gain access to uploaded files after successful authentication: see playwright spec");
  test.skip("View shortened and linked repository URL in the UI: see playwright spec");

  test.skip("Add a new team member to the Cognito user pool: requires real Cognito");
  test.skip("Remove a team member: requires real Cognito");
  test.skip("Configure web UI with stack outputs: human config step");
  test.skip("Update Cognito callback URLs: assertion at deploy time");
  test.skip("Create a test user and verify they can authenticate: requires real Cognito");
  test.skip("Self-register as @codespeak.dev staff member: requires real Cognito");
  test.skip("Receive temporary password and set permanent on first login: requires real email + Cognito");
  test.skip("View authenticated user's email in the UI: not surfaced in current static page");
  test.skip("Access via custom domain admin.vibe-share.codespeak.dev: requires real DNS + ACM");
  test.skip("Request ACM certificate in us-east-1 and add DNS validation record: requires real ACM");
  test.skip("Deploy CDK stack and receive live infrastructure outputs: requires real AWS");
});
