export const config = {
  region: "eu-north-1",

  alarmEmail: "a+alarms@codespeak.dev",

  // SSM parameter name containing the Slack incoming webhook URL (legacy, kept for alarm fallback).
  slackWebhookSsmParam: "/vibe-share/slack-webhook-url",

  // SSM parameter names for Slack Web API (used for threaded upload notifications).
  // Create before deploying:
  //   aws ssm put-parameter --name /vibe-share/slack-bot-token --type SecureString --value "xoxb-..."
  //   aws ssm put-parameter --name /vibe-share/slack-channel-id --type String --value "C0XXXXXXX"
  slackBotTokenSsmParam: "/vibe-share/slack-bot-token",
  slackChannelIdSsmParam: "/vibe-share/slack-channel-id",

  adminUiUrl: "https://admin.vibe-share.codespeak.dev",

  // Cognito hosted UI domain prefix.
  // The full domain will be: <prefix>.auth.<region>.amazoncognito.com
  cognitoDomainPrefix: "codespeak-vibe-share",

  // Allowed CORS origins.
  // S3 supports wildcards; API Gateway HTTP API v2 does NOT — list subdomains explicitly.
  corsAllowedOrigins: [
    "https://codespeak.dev",
    "https://app.codespeak.dev",
    "https://www.codespeak.dev",
  ],

  // S3 CORS can use wildcards, so we add the wildcard here for future subdomains.
  s3CorsAllowedOrigins: [
    "https://codespeak.dev",
    "https://*.codespeak.dev",
  ],
};
