# Meta App Review package, 2026-10-22

App 1038331905909624 (Instagram + WhatsApp in Betsy). Goal: one complete submission that adds
`whatsapp_business_manage_events` and `instagram_manage_events` (advanced access) and re-confirms the permissions already
approved.

| File | For | What it is |
|---|---|---|
| [dashboard-checklist.md](dashboard-checklist.md) | Rafael | Every step only you can do, in order: deploy + SQL 058, Business Verification, URLs, login configurations, Marketing API tier, submit. Also the decisions waiting on you. |
| [reviewer-instructions.md](reviewer-instructions.md) | Rafael, then Meta | How to prepare the test login and test chats, and the text to paste as reviewer instructions. |
| [screencast-script.md](screencast-script.md) | Rafael | Step-by-step recordings showing each permission, including ad chat → order → paid → event, for WhatsApp and Instagram. |
| [permissions.md](permissions.md) | Meta form | "How will your app use this permission?" text for each of the 11 permissions. |
| [data-handling-answers.md](data-handling-answers.md) | Meta form | Data handling questionnaire answers that match /privacy. |

## What changed in Betsy for this review (branch `claude/wave-meta-compliance-fe6c0c`)

- **/privacy** tells the exact truth: what is collected, every outside company with purpose and region, AI use, real
  retention, disconnect vs deletion, the 30-day manual erase, data stored in the US, ad measurement for WhatsApp and
  Instagram.
- **/data-deletion** shows the real status of a deletion request and explains disconnect vs deletion (Spanish + English).
- **Deletion callback** (`/api/auth/instagram/data-deletion`) now finds the lines by the Facebook user who connected them
  (before, it matched the Instagram account id and found nothing). It disconnects them at once, emails the owner,
  and 3 days later deletes chats, messages, media files, ad referrals and AI records. A line reconnected meanwhile goes to
  manual review. Files that fail to delete are retried every night. The callbacks refuse stale or replayed requests and
  run only on the production container. New **deauthorize
  callback** (`/api/auth/meta/deauthorize`) disconnects only.
- **Instagram purchase events** through the Conversions API for Business Messaging, next to the WhatsApp ones.

## Facts checked against Meta's doc

Source: developers.facebook.com/docs/marketing-api/conversions-api/business-messaging (read 2026-10-22).

- Instagram: `POST graph.facebook.com/{IG_USER_ID}/dataset` with the Facebook Login for Business token, which returns the
  existing dataset if there is one. Then `POST /{DATASET_ID}/events` with `action_source: business_messaging`,
  `messaging_channel: instagram`, `user_data: { instagram_business_account_id, ig_sid }` and
  `custom_data: { currency, value }`. There is no click id on Instagram.
- `IG_USER_ID` is the same id as `instagram_business_account_id`, the id the Page returns in `instagram_business_account`.
  Betsy stores it as `SocialAccount.accountId`.
- Purchase optimization is not available for Instagram ads. Instagram events are for measurement and reporting.
- Meta does not deduplicate. Betsy sends one event per order (`betsy:order:<id>:Purchase`, unique in the outbox).
- The Marketing API access tier is required for both permissions. The page's banner gives a lower call threshold than
  its body text, so check the number in the dashboard.
