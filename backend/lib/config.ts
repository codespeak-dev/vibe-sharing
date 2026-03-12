export const config = {
  region: "eu-north-1",

  alarmEmail: "a+alarms@codespeak.dev",

  // SSM parameter name containing the Slack incoming webhook URL.
  // Create it before deploying:
  //   aws ssm put-parameter --name /vibe-share/slack-webhook-url --type SecureString --value "https://hooks.slack.com/services/..."
  slackWebhookSsmParam: "/vibe-share/slack-webhook-url",

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
