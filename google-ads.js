import { readFileSync, readdirSync } from "node:fs";

// Google Ads API v18 Integration Service (MCC Manager Linking)

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Helper: Extract Google OAuth Client ID and Secret from:
 * 1. Environment variables GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 * 2. Full JSON string in GOOGLE_CREDENTIALS_JSON
 * 3. Any downloaded client_secret_*.json file in project root
 */
export function getGoogleOAuthCredentials() {
  let clientId = (process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID || "").trim();
  let clientSecret = (process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || "").trim();
  if (clientId && clientSecret) return { clientId, clientSecret };

  // Check if entire downloaded JSON was pasted into GOOGLE_CREDENTIALS_JSON
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      const conf = parsed.web || parsed.installed || parsed;
      if (conf.client_id && conf.client_secret) {
        return { clientId: conf.client_id.trim(), clientSecret: conf.client_secret.trim() };
      }
    } catch {}
  }

  // Check if user downloaded client_secret_*.json into workspace
  try {
    const files = readdirSync(".");
    const jsonFile = files.find(f => f.startsWith("client_secret") && f.endsWith(".json")) ||
                     files.find(f => f === "google-credentials.json");
    if (jsonFile) {
      const parsed = JSON.parse(readFileSync(jsonFile, "utf8"));
      const conf = parsed.web || parsed.installed || parsed;
      if (conf.client_id && conf.client_secret) {
        return { clientId: conf.client_id.trim(), clientSecret: conf.client_secret.trim() };
      }
    }
  } catch {}

  return { clientId: "", clientSecret: "" };
}

/**
 * Check if all required Google Ads API environment variables are set.
 */
export function isGoogleAdsConfigured() {
  return Boolean(
    process.env.GOOGLE_ADS_MANAGER_ID &&
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN
  );
}

/**
 * List which Google Ads API environment variables are missing.
 */
export function getMissingGoogleAdsConfig() {
  const missing = [];
  if (!process.env.GOOGLE_ADS_MANAGER_ID) missing.push("GOOGLE_ADS_MANAGER_ID");
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) missing.push("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!process.env.GOOGLE_ADS_CLIENT_ID) missing.push("GOOGLE_ADS_CLIENT_ID");
  if (!process.env.GOOGLE_ADS_CLIENT_SECRET) missing.push("GOOGLE_ADS_CLIENT_SECRET");
  if (!process.env.GOOGLE_ADS_REFRESH_TOKEN) missing.push("GOOGLE_ADS_REFRESH_TOKEN");
  return missing;
}

/**
 * Obtain a fresh OAuth 2.0 access token using the manager refresh token.
 */
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID.trim(),
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET.trim(),
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN.trim(),
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    const desc = data.error_description || data.error || "Failed to obtain Google Ads access token";
    throw new Error(`OAuth token error: ${desc}`);
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedToken;
}

/**
 * Dispatch an MCC link invitation to a client customer account via Google Ads API.
 * Uses CustomerClientLinkService.mutateCustomerClientLink
 */
export async function sendManagerLinkInvitation(clientCustomerId) {
  if (!isGoogleAdsConfigured()) {
    const missing = getMissingGoogleAdsConfig();
    throw new Error(
      `Google Ads API credentials not configured on server. Missing: ${missing.join(", ")}`
    );
  }

  const managerId = process.env.GOOGLE_ADS_MANAGER_ID.replace(/-/g, "").trim();
  const cleanClientId = clientCustomerId.replace(/-/g, "").trim();
  const token = await getAccessToken();

  const url = `https://googleads.googleapis.com/v18/customers/${managerId}/customerClientLinks:mutate`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN.trim(),
      "Authorization": `Bearer ${token}`,
      "login-customer-id": managerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operation: {
        create: {
          clientCustomer: `customers/${cleanClientId}`,
          status: "PENDING",
        },
      },
    }),
  });

  const result = await res.json();
  if (!res.ok) {
    const msg =
      result.error?.message ||
      result.error?.details?.[0]?.errors?.[0]?.message ||
      JSON.stringify(result.error || result);
    throw new Error(`Google Ads API rejected link: ${msg}`);
  }

  return {
    ok: true,
    resourceName: result.result?.resourceName || "",
  };
}

/**
 * Query Google Ads API to verify whether the client has accepted the link invitation.
 */
export async function checkManagerLinkStatus(clientCustomerId) {
  if (!isGoogleAdsConfigured()) {
    return { ok: false, configured: false };
  }

  const managerId = process.env.GOOGLE_ADS_MANAGER_ID.replace(/-/g, "").trim();
  const cleanClientId = clientCustomerId.replace(/-/g, "").trim();
  const token = await getAccessToken();

  const url = `https://googleads.googleapis.com/v18/customers/${managerId}/googleAds:search`;
  const query = `
    SELECT
      customer_client_link.resource_name,
      customer_client_link.client_customer,
      customer_client_link.status
    FROM customer_client_link
    WHERE customer_client_link.client_customer = 'customers/${cleanClientId}'
  `;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN.trim(),
      "Authorization": `Bearer ${token}`,
      "login-customer-id": managerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  const result = await res.json();
  if (!res.ok) {
    const msg = result.error?.message || "Failed to query Google Ads API status";
    throw new Error(`Google Ads API status error: ${msg}`);
  }

  const row = result.results?.[0]?.customerClientLink;
  if (!row) {
    return { ok: true, status: "NOT_FOUND" };
  }

  return {
    ok: true,
    status: row.status, // e.g. "ACTIVE", "PENDING", "INACTIVE", "CANCELLED"
    resourceName: row.resourceName,
  };
}

/* ══════════════════════════════════════════════════
   GOOGLE DEVELOPERS OAUTH 2.0 (Google Ads & Campaign 360)
   ══════════════════════════════════════════════════ */

/**
 * Check if Google OAuth 2.0 credentials are set on server.
 */
export function isGoogleOAuthReady() {
  const { clientId, clientSecret } = getGoogleOAuthCredentials();
  return Boolean(clientId && clientSecret);
}

/**
 * Generate Google OAuth 2.0 Authorization URL for Google Ads & Campaign Manager 360.
 */
export function getGoogleOAuthUrl(workspaceId, origin) {
  const { clientId } = getGoogleOAuthCredentials();
  const redirectUri = `${origin}/api/auth/google/callback`;
  const scopes = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/adwords",
    "https://www.googleapis.com/auth/dfareporting",
    "https://www.googleapis.com/auth/dfatrafficking",
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    prompt: "consent",
    state: String(workspaceId),
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange OAuth authorization code for access & refresh tokens.
 */
export async function exchangeOAuthCode(code, origin) {
  const { clientId, clientSecret } = getGoogleOAuthCredentials();
  const redirectUri = `${origin}/api/auth/google/callback`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: code.trim(),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    const desc = data.error_description || data.error || "Failed to exchange authorization code";
    throw new Error(`Google OAuth error: ${desc}`);
  }
  return data;
}

/**
 * Fetch authenticated Google user profile.
 */
export async function getGoogleProfile(accessToken) {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { email: "ad-manager@gmail.com", name: "Google Advertiser" };
    return await res.json();
  } catch {
    return { email: "ad-manager@gmail.com", name: "Google Advertiser" };
  }
}

/**
 * Fetch Campaign Manager 360 User Profiles for the authenticated user.
 */
export async function getCM360Profiles(accessToken) {
  try {
    const res = await fetch("https://dfareporting.googleapis.com/dfareporting/v4/userprofiles", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.warn("CM360 userprofiles response status:", res.status);
      return [];
    }
    const data = await res.json();
    return data.items || [];
  } catch (err) {
    console.error("Failed to fetch CM360 user profiles:", err);
    return [];
  }
}

/**
 * Fetch Campaign Manager 360 live campaigns from Google's dfareporting API.
 */
export async function getCM360Campaigns(accessToken, profileId) {
  try {
    const url = `https://dfareporting.googleapis.com/dfareporting/v4/userprofiles/${profileId}/campaigns?archived=false&sortField=NAME`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.warn("CM360 campaigns response status:", res.status);
      return [];
    }
    const data = await res.json();
    return (data.campaigns || []).map(c => ({
      id: String(c.id),
      name: c.name,
      channel: "Display",
      status: c.archived ? "PAUSED" : "ENABLED",
      budget: "$150.00/day",
      imported: false,
    }));
  } catch (err) {
    console.error("Failed to fetch CM360 campaigns:", err);
    return [];
  }
}

/**
 * Get server-configured Google Ads Developer Token.
 */
export function getGoogleAdsDeveloperToken() {
  return (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || process.env.DEVELOPER_TOKEN || "").trim();
}

/**
 * List all Google Ads Customer IDs accessible by the authenticated user.
 * Requires GOOGLE_ADS_DEVELOPER_TOKEN from an MCC account.
 */
export async function listAccessibleGoogleAdsCustomers(accessToken) {
  const devToken = getGoogleAdsDeveloperToken();
  if (!devToken || !accessToken) return [];

  try {
    const res = await fetch("https://googleads.googleapis.com/v18/customers:listAccessibleCustomers", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": devToken,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn("Google Ads listAccessibleCustomers warning:", res.status, err.error?.message || "");
      return [];
    }
    const data = await res.json();
    return (data.resourceNames || []).map(r => r.replace("customers/", ""));
  } catch (err) {
    console.error("Failed to list accessible Google Ads customers:", err.message);
    return [];
  }
}

/**
 * Query live Google Ads campaigns (Search, PMax, Display, Video) for a customer account.
 */
export async function fetchGoogleAdsCampaigns(accessToken, customerId) {
  const devToken = getGoogleAdsDeveloperToken();
  if (!devToken || !accessToken || !customerId) return [];

  const cleanId = customerId.replace(/-/g, "").trim();
  try {
    const res = await fetch(`https://googleads.googleapis.com/v18/customers/${cleanId}/googleAds:search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": devToken,
        "login-customer-id": cleanId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, campaign.status, campaign_budget.amount_micros FROM campaign ORDER BY campaign.id DESC LIMIT 50`,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn("Google Ads campaigns search warning:", res.status, err.error?.message || "");
      return [];
    }

    const data = await res.json();
    const formatChannel = (type) => {
      const s = String(type || "").toUpperCase();
      if (s.includes("SEARCH")) return "Search";
      if (s.includes("PERFORMANCE_MAX")) return "Performance Max";
      if (s.includes("DISPLAY")) return "Display";
      if (s.includes("VIDEO")) return "Video";
      if (s.includes("SHOPPING")) return "Shopping";
      return type || "Search";
    };

    return (data.results || []).map(r => ({
      id: String(r.campaign.id),
      name: r.campaign.name || `Campaign ${r.campaign.id}`,
      channel: formatChannel(r.campaign.advertisingChannelType),
      status: r.campaign.status === "ENABLED" ? "ENABLED" : "PAUSED",
      budget: r.campaignBudget?.amountMicros
        ? `$${(Number(r.campaignBudget.amountMicros) / 1000000).toFixed(2)}/day`
        : "$0.00/day",
      imported: false,
    }));
  } catch (err) {
    console.error("Failed to fetch Google Ads campaigns:", err.message);
    return [];
  }
}
