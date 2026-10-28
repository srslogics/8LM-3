// Google Ads API v18 Integration Service (MCC Manager Linking)

let cachedToken = null;
let tokenExpiresAt = 0;

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
