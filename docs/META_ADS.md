# Meta Ads

8LM supports workspace-scoped Meta authorization, active ad account selection,
campaign reporting and campaign import selection. Publishing supports website traffic (OUTCOME_TRAFFIC) and website sales
(OUTCOME_SALES), one ad set, one single-image ad, country targeting (India, US or UK),
configurable ages 18–65+ and gender, and Facebook Feed. Traffic optimises link clicks;
sales optimises website conversions using an accessible account pixel and a standard
event. Budgets can be set at campaign or ad-set level. Optional start/end timestamps
are stored with explicit time zones.
Campaign, ad set and ad are created PAUSED. Instagram placements, objectives beyond Traffic/Sales,
special ad categories and image uploads are not included in this builder. Existing
Meta campaigns of other objectives can still be listed and reported.

## Meta and Render setup

1. Create the 8LM app in Meta for Developers. Enable the Marketing API use cases for
   managing ads and measuring ad performance.
2. In Facebook Login for Business → Settings, set the exact Valid OAuth Redirect URI:
   `https://eightlm-3-g5wy.onrender.com/api/auth/meta/callback`.
3. In Configurations create a General login configuration using a **User access
   token**, with permissions `ads_read`, `ads_management`, `pages_show_list`,
   `pages_read_engagement`, `pages_manage_ads`. Permit ad accounts and Pages.
4. In Render → web service → Environment set:

   | Variable | Value |
   | --- | --- |
   | META_APP_ID | App settings → Basic → App ID |
   | META_APP_SECRET | App settings → Basic → App Secret |
   | META_LOGIN_CONFIG_ID | Saved login Configuration ID |
   | META_API_VERSION | v26.0 |
   | META_TOKEN_ENCRYPTION_KEY | Fernet key generated once below |
   | APP_ORIGIN | https://eightlm-3-g5wy.onrender.com |

   Generate the key in the project environment:
   `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
   Do not commit credentials. Preserve the encryption key across deployments.
   Changing or losing it requires reconnecting Meta for every workspace.
5. Keep existing DATABASE_URL and DATABASE_URL_UNPOOLED. The normal Render start
   command `sh scripts/start.sh` applies migration 011 before starting the server.
   Build: `pip install --require-hashes -r requirements.txt`.
6. Start with an app admin/developer/tester who has access to the ad account and
   advertising permission for the Page. Public customer onboarding depends on the
   app review, access level, Tech Provider/business verification and publishing
   requirements shown in your Meta dashboard. Supply real privacy-policy and data
   deletion instructions URLs where Meta requires them.

## User flow

Open a workspace → Meta Ads → Connect with Meta → grant access → select an active
ad account. Campaigns and date-range metrics load from Meta. Check campaigns and
save the import selection; imported-only filters that saved selection. Import is
tracking in 8LM, not copying or changing the remote campaigns.

Choose Create campaign, enter names, confirm the special-category exclusion,
choose country and budget, then choose an accessible Page and an image already
uploaded to the selected ad account. Upload images through Ads Manager and refresh
resources if necessary. Enter the website URL and creative copy, review, then save
a draft. Saving has no remote effect. An Owner, Admin or Publisher reviews the
saved configuration and confirms **Publish paused**. Enable delivery only after
reviewing it in Ads Manager. Meta may reject account-specific settings or minimum
budgets; a local acceptance test cannot guarantee Meta will accept every account.

## Access and storage

Owners/Admins connect, select accounts and disconnect. Editors, Publishers,
Admins and Owners save drafts and select imports. Publishers/Admins/Owners publish.
Viewers can view reports and drafts. All routes validate membership server-side.
Google credentials and Meta credentials have separate tables and flows.

OAuth states are hashed, single-use, session/user/workspace-bound and expire in ten
minutes. Callback checks current management permissions and validates the token's
app ID, user ID, token type, granted scopes and expiry. Meta tokens are encrypted
using Fernet before PostgreSQL storage; API responses never expose them. Requests
use server-side Bearer authorization and appsecret_proof. HTTPX Graph URL logging
is redacted. User and data-access expiry are honored: reconnect when Meta expires
or revokes access. A deployment does not by itself discard the connection.

Disconnect removes local tokens, account selection and OAuth states. It does not
revoke the user's Meta-side business integration or delete remote resources.
Drafts and publication history remain for audit/recovery.

## Publishing and recovery

Meta requires four separate writes: campaign → ad set → creative → ad. This is not
an atomic transaction. Each confirmed ID is committed independently; completed
steps survive failures and server restarts. Workspace locking serializes publish
and account changes. A draft is bound to the account and currency at creation.
Supported budget currencies: INR, USD, GBP, EUR, AUD, CAD, SGD (100 minor units).

A definite rejection becomes FAILED. Resume reuses confirmed steps. A timeout,
invalid creation response or server/transient failure becomes UNKNOWN (or SENDING
if the process died). Check publication status reconciles the exact UUID-marked
resource name under the original account and parent before proceeding. If Meta
has not confirmed that resource, no duplicate create is sent. Check Ads Manager
and retry the status check later; unresolved ambiguity requires manual review.
Partial resources remain paused and IDs are visible in publication history. There
is no automatic rollback or deletion of external resources.

Campaign retrieval paginates against the same Graph host and resource; supplied
next URLs are never followed. Reporting failures show unavailable metrics rather
than false zero performance. Graph error responses are mapped to safe messages
without returning raw upstream payloads or secrets.

## Verification

`python -m pytest --integration -q` uses an explicitly isolated PostgreSQL database
and mocked Graph HTTP responses, including lost-response recovery, rejection,
concurrent retries, permissions, OAuth replay/session binding and encrypted tokens.
`python -m pytest --browser tests/test_browser.py tests/test_meta_browser.py -q`
checks the Google builders and Meta UI with browser API fixtures. Neither test
suite creates live Meta ads. Before public release, verify a real OAuth connection,
Page/image access, reporting and one paused publication using your configured app.


## Expanded campaign editor

The editor follows Campaign → Ad set → Ad creative → Review, with a persistent
step rail on desktop. Manual setup exposes objective, dataset and conversion event,
budget scope, dates, country, minimum/maximum age and gender. Review includes an ad
copy preview and the full saved configuration. Dataset options come from the selected
account's `/adspixels` edge and are validated again before draft save and publication.
Users must configure tracking and event eligibility in Events Manager. Dataset
visibility alone does not establish that conversion events are being received.

Facebook Feed is the explicit placement supported here. Advantage+ shopping,
customer acquisition rules, custom audiences, Instagram identities, special ad
categories, A/B testing and other conversion destinations shown in the reference
screens are not implemented. They are not presented as working toggles.
Existing Traffic drafts retain their original defaults. JSON payloads carry the
new settings without a schema migration. No remote campaigns are edited by this UI
change; each publication remains paused and requires separate confirmation.
