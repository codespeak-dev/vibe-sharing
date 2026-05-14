import { describe, test } from "vitest";
import { Match } from "aws-cdk-lib/assertions";
import { getStackTemplate } from "../helpers/cdk-template.js";
import { expect } from "vitest";

const template = getStackTemplate();

describe("Feature: Zero-Configuration Public Endpoint", () => {
  test("CLI defaults to https://vibe-share.codespeak.dev when VIBE_SHARING_API_URL is unset", async () => {
    // The src/config.ts module hard-codes "https://vibe-share.codespeak.dev"
    // as the default and only overrides via the VIBE_SHARING_API_URL env var.
    // Read the source verbatim and assert the literal default appears.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(
      path.join(process.cwd(), "src", "config.ts"),
      "utf8",
    );
    expect(src).toMatch(
      /DEFAULT_API_URL\s*=\s*["']https:\/\/vibe-share\.codespeak\.dev["']/,
    );
    expect(src).toMatch(/process\.env\.VIBE_SHARING_API_URL\s*\?\?\s*DEFAULT_API_URL/);
  });

  test("ACM certificate for vibe-share.codespeak.dev is requested with DNS validation", () => {
    template.hasResourceProperties("AWS::CertificateManager::Certificate", {
      DomainName: "vibe-share.codespeak.dev",
      ValidationMethod: "DNS",
    });
  });

  test("API Gateway custom domain is wired to vibe-share.codespeak.dev", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "vibe-share.codespeak.dev",
    });
  });

  test("/health route is unauthenticated", () => {
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /health",
      AuthorizationType: "NONE",
    });
  });

  test("Stack outputs include CustomDomainTarget for DNS instructions", () => {
    template.hasOutput("CustomDomainTarget", Match.anyValue());
  });

  test.skip("npx run with no configuration: requires real CLI invocation against real DNS");
  test.skip("Upload succeeds without server URL: requires deployed backend");
  test.skip("Add ACM DNS validation CNAME and certificate validates: requires real DNS");
  test.skip("Receive DNS record instructions referencing custom domain: human-output scenario");
  test.skip("Access from a third-party machine via public domain: requires deployed backend + real DNS");
  test.skip("curl https://vibe-share.codespeak.dev/health from external machine: requires deployed backend + DNS");
});
