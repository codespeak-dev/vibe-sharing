import type { PreSignUpTriggerEvent } from "aws-lambda";

const ALLOWED_DOMAIN = "codespeak.dev";

export async function handler(event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> {
  const email = event.request.userAttributes.email;

  if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    throw new Error(`Only @${ALLOWED_DOMAIN} email addresses are allowed to register.`);
  }

  return event;
}
