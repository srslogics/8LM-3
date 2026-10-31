# HTTP API compatibility

Paths and JSON envelopes remain compatible with the current browser interface. Pydantic rejects unknown fields and invalid types. Validation errors return HTTP 400 with an error message and field locations, never submitted passwords. Missing sessions return 401; forbidden roles 403; inaccessible workspaces 404.

| Area | Routes |
|---|---|
| Authentication | POST /api/auth/signup, POST /api/auth/login, GET /api/me, POST /api/logout |
| Workspaces | GET/POST /api/workspaces; GET/PATCH/DELETE /api/workspaces/{wid} |
| Invitations | POST .../invites; DELETE .../invites/{id}; POST /api/workspaces/accept |
| Membership | PATCH/DELETE .../members/{id}; POST .../transfer |
| OAuth | GET .../auth/google/url; GET /api/auth/google/callback |
| Google account | GET/DELETE .../ads; GET .../ads/accounts; POST .../ads/customer-id |
| Campaign sync | GET .../ads/campaigns; POST .../ads/campaigns/import |
| Drafts | POST .../campaigns/create; GET .../campaigns/drafts |
| Publication | POST .../campaigns/{uuid}/publish |
| Google status | PATCH .../campaigns/{id}/status |
| Local tracking | DELETE .../campaigns/{id} |
| Operations | GET /health |

Ellipses denote /api/workspaces/{wid}.

Publication returns 200 with a confirmed Google resource, 202 with pending:true for unresolved outcomes, or an error for definitive rejection. Repeating a confirmed publication returns its resource. Untracking never deletes the Google campaign.

Legacy demo, unverified link and CM360 routes are absent. Default workspace creation is explicit; Node's test-only auto-create behavior was not a production contract.

ENABLE_API_DOCS=true exposes /openapi.json locally with typed request schemas. Response envelopes remain service dictionaries for compatibility; introduce explicit response DTOs as the API evolves.

Campaign creation uses a discriminated `channel` contract: Search, Performance Max, Demand Gen, Display, or Shopping. See `app/api/campaign_types.py` and OpenAPI for exact required fields. Non-applicable fields are rejected. Existing Search JSON is unchanged.

`GET /api/workspaces/{wid}/ads/creative-resources/images` and `/audiences` return `{customer_id, items}` for the selected account, limited to 200 results. Workspace editors and publishers can read these resources. Requests use the workspace OAuth connection and manager ID; browser callers never supply credentials. Asset/audience references must belong to the draft account. Google image metadata is checked again before validation and publication.
