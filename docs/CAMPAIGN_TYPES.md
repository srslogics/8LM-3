# Campaign builder support

The existing nine-step flow is preserved. Select a type, enter its settings, save a draft, review it, and confirm **Publish paused**. Nothing is enabled automatically. No schema migration or new paid service is required.

| Type | Supported format | Bidding | Prerequisites |
| --- | --- | --- | --- |
| Search | One ad group with keywords and a responsive search ad | Manual CPC | HTTPS landing page, keywords, headlines and descriptions |
| Performance Max | Standard non-retail campaign with one asset group | Maximize conversions | Account conversion goals/tracking, business name, text, landscape image, square image and square logo |
| Demand Gen | One ad group with a multi-asset image ad | Maximize clicks | Text, business name, three image roles and an existing account audience |
| Display | One ad group with a responsive display ad | Manual CPC | Text, long headline, business name and three image roles |
| Shopping | Standard Shopping, one all-products listing group | Manual CPC | Linked Merchant Center ID, exact feed label, approved products and explicit all-products confirmation |
| Video | External handoff to Google Ads | — | Standard Video creation is not exposed by this builder |

## Targeting and creative scope

Country selection remains India, United States or United Kingdom, with presence targeting. New formats use English. Search keeps its existing language behavior and partners/Display settings. Display has broad country targeting without audience or placement restrictions. Demand Gen uses the selected audience, optimized targeting disabled, and explicitly uses campaign-level geographic/language targeting (`upgradedTargeting=false`). Google controls eligible placements and default creative automation.

Performance Max uses campaign-level brand assets with brand guidelines enabled. Final URL expansion is opted out through the current asset automation field (the old `url_expansion_opt_out` field is no longer supported). Google may generate video, enhanced images and text under other default automation settings. The UI asks the user to confirm existing conversion setup; 8LM does not create conversion actions.

The asset picker reuses up to 200 recent images from the selected Google account. It filters landscape images (1.91:1, at least 600×314), square images (at least 300×300) and logos (at least 128×128). The server rechecks asset ownership, type and dimensions from Google before publishing. Upload images and create audiences in Google Ads, then refresh the picker. This release does not upload binary images, create audiences, create Merchant Center links, add retail PMax feeds, support Demand Gen video/carousel ads, or expose every advanced Google Ads setting. Google validates account eligibility, policy, feed linkage and creative requirements before creation.

## Publishing guarantees

- Drafts remain scoped to workspace and selected account; only Owner/Admin/Publisher can publish.
- One atomic Google mutation creates the budget and all dependent campaign entities, with `partialFailure=false` and validation first.
- Durable SENDING/UNKNOWN states and the UUID campaign marker prevent blind retries after lost responses.
- All campaigns are created PAUSED. Published campaign records preserve their real channel.
- No production campaign is created by automated tests; Google responses are mocked.

## Official implementation references

- [Performance Max asset requirements](https://developers.google.com/google-ads/api/performance-max/asset-requirements)
- [Asset automation settings](https://developers.google.com/google-ads/api/docs/assets/asset-automation-settings)
- [Demand Gen campaign creation](https://developers.google.com/google-ads/api/docs/demand-gen/create-campaign)
- [Audience targeting](https://developers.google.com/google-ads/api/docs/remarketing/audiences)
- [Responsive display ads](https://developers.google.com/google-ads/api/docs/responsive-display-ads/create-responsive-display-ads)
- [Standard Shopping sample](https://developers.google.com/google-ads/api/samples/add-shopping-product-ad)
- [Campaign API limitations](https://developers.google.com/google-ads/api/docs/campaigns/overview)
