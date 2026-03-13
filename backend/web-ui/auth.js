// Cognito OAuth helpers (Authorization Code + PKCE)

function getConfig() {
  return window.VIBE_SHARE_CONFIG;
}

function generateRandomString(length) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function redirectToLogin() {
  const cfg = getConfig();
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  sessionStorage.setItem("pkce_code_verifier", codeVerifier);
  sessionStorage.setItem("return_url", window.location.href);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: "openid email profile",
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });

  window.location.href = `https://${cfg.cognitoDomain}/oauth2/authorize?${params}`;
}

async function exchangeCodeForTokens(code) {
  const cfg = getConfig();
  const codeVerifier = sessionStorage.getItem("pkce_code_verifier");
  if (!codeVerifier) {
    throw new Error("Missing PKCE code verifier");
  }

  const response = await fetch(`https://${cfg.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cfg.clientId,
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const tokens = await response.json();
  sessionStorage.removeItem("pkce_code_verifier");
  sessionStorage.setItem("id_token", tokens.id_token);
  sessionStorage.setItem("access_token", tokens.access_token);
  return tokens;
}

function getIdToken() {
  return sessionStorage.getItem("id_token");
}

function isLoggedIn() {
  return !!getIdToken();
}

function logout() {
  const cfg = getConfig();
  sessionStorage.removeItem("id_token");
  sessionStorage.removeItem("access_token");
  sessionStorage.removeItem("pkce_code_verifier");
  window.location.href = `https://${cfg.cognitoDomain}/logout?client_id=${cfg.clientId}&logout_uri=${encodeURIComponent(window.location.origin + "/")}`;
}
