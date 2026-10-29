const API = "https://googleads.googleapis.com/v26";
export class GoogleError extends Error {
  constructor(message, status = 400, uncertain = false) {
    super(message);
    this.status = status;
    this.uncertain = uncertain;
  }
}
export function getGoogleOAuthCredentials() {
  return {
    clientId: (
      process.env.GOOGLE_CLIENT_ID ||
      process.env.GOOGLE_ADS_CLIENT_ID ||
      ""
    ).trim(),
    clientSecret: (
      process.env.GOOGLE_CLIENT_SECRET ||
      process.env.GOOGLE_ADS_CLIENT_SECRET ||
      ""
    ).trim(),
  };
}
export function isGoogleOAuthReady() {
  const c = getGoogleOAuthCredentials();
  return Boolean(c.clientId && c.clientSecret);
}
export function getGoogleAdsDeveloperToken() {
  return (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
}
async function jsonFetch(url, options = {}, mutation = false) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new GoogleError(
      mutation
        ? "Google’s response was interrupted. Check publication status before trying again."
        : "Google could not be reached. Try again.",
      502,
      mutation,
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new GoogleError(
      "Google returned an unreadable response.",
      502,
      mutation,
    );
  }
  if (!response.ok) {
    const errors = data.error?.details?.flatMap((d) => d.errors || []) || [];
    const message =
      errors.map((e) => e.message).join(" ") ||
      data.error_description ||
      data.error?.message ||
      "Google rejected this request. Reconnect your Google account if authorization expired.";
    throw new GoogleError(
      String(message).slice(0, 1800),
      response.status === 401 ? 401 : 400,
      mutation && response.status >= 500,
    );
  }
  return data;
}
export function getGoogleOAuthUrl(state, challenge, origin) {
  const params = new URLSearchParams({
    client_id: getGoogleOAuthCredentials().clientId,
    redirect_uri: origin + "/api/auth/google/callback",
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params;
}
export async function exchangeOAuthCode(code, verifier, origin) {
  const { clientId, clientSecret } = getGoogleOAuthCredentials();
  return jsonFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      code,
      code_verifier: verifier,
      redirect_uri: origin + "/api/auth/google/callback",
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
    }),
  });
}
export async function refreshGoogleToken(refreshToken) {
  const { clientId, clientSecret } = getGoogleOAuthCredentials();
  return jsonFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
}
export async function getGoogleProfile(token) {
  const data = await jsonFetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: "Bearer " + token } },
  );
  if (!data.sub || !data.email || !data.email_verified)
    throw new GoogleError("Google did not return a verified account email.");
  return data;
}
export async function adsRequest(
  token,
  customerId,
  method,
  body,
  managerId,
  mutation = false,
) {
  if (!getGoogleAdsDeveloperToken())
    throw new GoogleError(
      "GOOGLE_ADS_DEVELOPER_TOKEN is not configured on the server.",
    );
  const headers = {
    Authorization: "Bearer " + token,
    "developer-token": getGoogleAdsDeveloperToken(),
    "Content-Type": "application/json",
  };
  if (managerId) headers["login-customer-id"] = managerId;
  return jsonFetch(
    `${API}/customers/${customerId}/${method}`,
    { method: "POST", headers, body: JSON.stringify(body) },
    mutation,
  );
}
export async function searchAds(token, id, query, managerId) {
  const rows = [];
  let pageToken;
  do {
    const result = await adsRequest(
      token,
      id,
      "googleAds:search",
      { query, ...(pageToken ? { pageToken } : {}) },
      managerId,
    );
    rows.push(...(result.results || []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return rows;
}
export async function listAccounts(token) {
  if (!getGoogleAdsDeveloperToken())
    throw new GoogleError(
      "GOOGLE_ADS_DEVELOPER_TOKEN is not configured on the server.",
    );
  const result = await jsonFetch(`${API}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: "Bearer " + token,
      "developer-token": getGoogleAdsDeveloperToken(),
    },
  });
  const accounts = new Map();
  const notices = [];
  for (const resource of result.resourceNames || []) {
    const id = resource.split("/").pop();
    try {
      const rows = await searchAds(
        token,
        id,
        "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1",
      );
      const c = rows[0]?.customer;
      if (!c) continue;
      if (!c.manager)
        accounts.set(String(c.id), {
          id: String(c.id),
          name: c.descriptiveName || String(c.id),
          currency: c.currencyCode,
          managerId: null,
        });
      else {
        const children = await searchAds(
          token,
          id,
          "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager FROM customer_client WHERE customer_client.manager = FALSE",
          id,
        );
        for (const row of children) {
          const child = row.customerClient;
          const key = String(child.id);
          if (!accounts.has(key))
            accounts.set(key, {
              id: key,
              name: child.descriptiveName || key,
              currency: child.currencyCode,
              managerId: id,
            });
        }
      }
    } catch (error) {
      notices.push(`Account ${id}: ${error.message}`);
    }
  }
  return { accounts: [...accounts.values()], notices };
}
export async function accountDetails(token, id, managerId) {
  if (!/^\d{10}$/.test(id))
    throw new GoogleError("Select a valid 10-digit Google Ads account.");
  const rows = await searchAds(
    token,
    id,
    "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1",
    managerId,
  );
  const c = rows[0]?.customer;
  if (!c || c.manager)
    throw new GoogleError(
      "Select an advertising account, not a manager account.",
    );
  return {
    id: String(c.id),
    name: c.descriptiveName || String(c.id),
    currency: c.currencyCode,
    managerId,
  };
}
export async function fetchCampaigns(token, id, managerId) {
  const rows = await searchAds(
    token,
    id,
    "SELECT campaign.id, campaign.resource_name, campaign.name, campaign.advertising_channel_type, campaign.status, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id DESC",
    managerId,
  );
  return rows.map(({ campaign: c, campaignBudget: b }) => ({
    id: String(c.id),
    resource: c.resourceName,
    name: c.name,
    channel: c.advertisingChannelType,
    status: c.status,
    budget: Number(b?.amountMicros || 0) / 1e6,
  }));
}
export async function campaignMetrics(token, id, managerId) {
  const rows = await searchAds(
    token,
    id,
    "SELECT metrics.impressions, metrics.clicks, metrics.cost_micros FROM customer WHERE segments.date DURING LAST_30_DAYS",
    managerId,
  );
  return rows.reduce(
    (a, r) => ({
      impressions: a.impressions + Number(r.metrics?.impressions || 0),
      clicks: a.clicks + Number(r.metrics?.clicks || 0),
      spend: a.spend + Number(r.metrics?.costMicros || 0) / 1e6,
    }),
    { impressions: 0, clicks: 0, spend: 0 },
  );
}
export function validateCampaign(input) {
  const text = (value, label, max) => {
    if (typeof value !== "string" || !value.trim() || value.trim().length > max)
      throw new GoogleError(
        `${label} is required (maximum ${max} characters).`,
      );
    return value.trim();
  };
  const name = text(input.name, "Campaign name", 100),
    adGroup = text(input.ad_group, "Ad group name", 100);
  if (input.channel !== "Search")
    throw new GoogleError(
      "Only Search campaigns are supported for publishing.",
    );
  const budget = Number(input.budget),
    cpc = Number(input.cpc);
  if (
    !Number.isFinite(budget) ||
    budget <= 0 ||
    budget > 1000000 ||
    !Number.isFinite(cpc) ||
    cpc <= 0 ||
    cpc > budget
  )
    throw new GoogleError(
      "Enter a positive daily budget and a maximum CPC no greater than the daily budget.",
    );
  let url;
  try {
    url = new URL(input.final_url);
  } catch {
    throw new GoogleError("Enter a valid HTTPS landing page URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new GoogleError(
      "Use an HTTPS landing page without embedded credentials.",
    );
  const lines = (value, label, min, max, length) => {
    if (typeof value !== "string")
      throw new GoogleError(`${label} must be one per line.`);
    const rows = value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      rows.length < min ||
      rows.length > max ||
      rows.some((s) => s.length > length) ||
      new Set(rows).size !== rows.length
    )
      throw new GoogleError(
        `${label}: use ${min}–${max} unique lines, each at most ${length} characters.`,
      );
    return rows;
  };
  const headlines = lines(input.headlines, "Headlines", 3, 15, 30),
    descriptions = lines(input.descriptions, "Descriptions", 2, 4, 90),
    keywords = lines(input.keywords, "Keywords", 1, 100, 80);
  if (!["PHRASE", "EXACT"].includes(input.match_type))
    throw new GoogleError("Choose phrase or exact match.");
  const countries = {
    India: "2356",
    "United States": "2840",
    "United Kingdom": "2826",
  };
  if (!countries[input.country])
    throw new GoogleError("Choose a supported target country.");
  if (input.eu_political !== false)
    throw new GoogleError(
      "Confirm this campaign does not contain EU political advertising.",
    );
  return {
    name,
    ad_group: adGroup,
    channel: "Search",
    budget,
    cpc,
    final_url: url.href,
    headlines,
    descriptions,
    keywords,
    match_type: input.match_type,
    country: input.country,
    geo_id: countries[input.country],
    eu_political: false,
  };
}
export function campaignOperations(customerId, payload, publicationId) {
  const base = `customers/${customerId}`,
    budget = base + "/campaignBudgets/-1",
    campaign = base + "/campaigns/-2",
    adGroup = base + "/adGroups/-3";
  return [
    {
      campaignBudgetOperation: {
        create: {
          resourceName: budget,
          name: `8LM budget ${publicationId}`,
          amountMicros: String(Math.round(payload.budget * 1e6)),
          deliveryMethod: "STANDARD",
          explicitlyShared: false,
        },
      },
    },
    {
      campaignOperation: {
        create: {
          resourceName: campaign,
          name: `${payload.name} [8LM ${publicationId}]`,
          advertisingChannelType: "SEARCH",
          status: "PAUSED",
          campaignBudget: budget,
          manualCpc: {},
          containsEuPoliticalAdvertising:
            "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: false,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false,
          },
          geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" },
        },
      },
    },
    {
      campaignCriterionOperation: {
        create: {
          campaign,
          location: {
            geoTargetConstant: "geoTargetConstants/" + payload.geo_id,
          },
        },
      },
    },
    {
      adGroupOperation: {
        create: {
          resourceName: adGroup,
          name: payload.ad_group,
          campaign,
          type: "SEARCH_STANDARD",
          status: "ENABLED",
          cpcBidMicros: String(Math.round(payload.cpc * 1e6)),
        },
      },
    },
    ...payload.keywords.map((text) => ({
      adGroupCriterionOperation: {
        create: {
          adGroup,
          status: "ENABLED",
          keyword: { text, matchType: payload.match_type },
        },
      },
    })),
    {
      adGroupAdOperation: {
        create: {
          adGroup,
          status: "ENABLED",
          ad: {
            finalUrls: [payload.final_url],
            responsiveSearchAd: {
              headlines: payload.headlines.map((text) => ({ text })),
              descriptions: payload.descriptions.map((text) => ({ text })),
            },
          },
        },
      },
    },
  ];
}
export async function publishCampaign(
  token,
  id,
  payload,
  publicationId,
  managerId,
  validateOnly = false,
) {
  return adsRequest(
    token,
    id,
    "googleAds:mutate",
    {
      mutateOperations: campaignOperations(id, payload, publicationId),
      partialFailure: false,
      validateOnly,
    },
    managerId,
    !validateOnly,
  );
}
export async function findPublication(token, id, publicationId, managerId) {
  const rows = await searchAds(
    token,
    id,
    `SELECT campaign.id, campaign.resource_name FROM campaign WHERE campaign.name LIKE '%${publicationId}%'`,
    managerId,
  );
  return rows[0]?.campaign?.resourceName;
}
export async function updateCampaignStatus(
  token,
  id,
  resource,
  status,
  managerId,
) {
  return adsRequest(
    token,
    id,
    "campaigns:mutate",
    {
      operations: [
        { update: { resourceName: resource, status }, updateMask: "status" },
      ],
    },
    managerId,
    true,
  );
}
