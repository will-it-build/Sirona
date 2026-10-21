# GymSpear assistant

Provider: Qwen Cloud pay-as-you-go, model `qwen3.7-flash`, endpoint
`https://maas.qwencloudapi.com/compatible-mode/v1`.
The dedicated GymSpear production key is stored as Worker secret `QWEN_API_KEY`.
No Workers AI binding is used. Ordinary Cloudflare hosting requests still count.

## Behaviour

- Authenticated Assistant tab: discuss routines, exercise questions and app help.
- Last 30 chat messages saved per account; up to six recent excerpts and the latest
  proposed plan form the bounded model context. Long context is trimmed to fit.
- Explicit consent before sending. Optional last-three synced workout context is
  selected server-side for that user only; it includes exercise names/weights/reps
  and dates, excluding bodyweight, session/exercise notes and sleep.
- Replies are plain text, never executed as HTML. Suggested sessions are validated.
- Only the user's explicit Add to my plan action creates new planned records.
  Proposals cannot delete, overwrite or log completed sessions. Accepting twice is
  idempotent, even after a saved record is edited or deleted.
- Clear conversation removes chat and proposals, preserves saved workouts and
  increments a revision so an in-flight response cannot bring deleted chat back.
- AI is online-only. Normal workout sync/offline operation remains unchanged.
- General assistance only; no diagnosis, medical clearance or medication advice.

## Costs and limits

Qwen Cloud charges actual usage at the next monthly settlement. Its console has
an enabled USD 10 monthly **alert**, emailed at 80% (USD 8). It is not a verified
hard cutoff. This account-level alert also covers other Qwen usage.

GymSpear independently enforces fixed limits with atomic D1 admission:
20 requests/user/UTC day, 50 requests/app/UTC day, 500 requests/app/UTC month.
One pending request per user for up to 60 seconds; request IDs cannot be replayed.
Failed attempts retain their reserved quota; no automatic provider retries.
8 KB serialized input, 2048 output tokens, 30-second timeout, bounded 128 KB
response, no redirects, exact host allowlist and thinking disabled.

At the researched Qwen3.7 Flash prices ($0.03/M input, $0.13/M output for short
contexts), a conservative $0.01 reservation per maximum-size request is well
above expected token cost; 500 calls corresponds to a $5 reserve before tax.
This is a request ceiling, NOT a provider-wide dollar guarantee. External key
use, other keys, price changes, taxes and FX are outside it. Review limits and
pricing before expanding signup or changing model. No automatic model fallback.

## Operations

`AI_ENABLED=false` in Wrangler disables new model requests. Past chat and plan
review remain accessible. `PUBLIC_SIGNUP` stays false.

Migration `0002_assistant.sql` only adds tables/indexes. Pre-migration Cloudflare
Time Travel bookmark (21 October 2026):
`000000ab-00000000-0000510b-f1edadef6f63d35ea732439029480c60`.
Use Worker rollback/AI kill switch for code issues. Do not restore the full
production database casually: that would discard later legitimate user writes.

Never commit, log or pass keys in command arguments. Use masked Wrangler secret
entry or restricted file input. Rotate the dedicated key if exposed.

## Verification

- 35 backend/provider/sync tests, seven browser tests, syntax checks and dry run.
- Real provider connection probe: 40 tokens, synthetic prompt only.
- Real model app-help + proposed-workout + explicit save verified using a local
  in-memory test account; no production records sent to Qwen.
- `scripts/check-qwen.mjs`: smallest live connection probe.
- `scripts/check-assistant.mjs`: two live synthetic messages and local acceptance.
  Both require a private env file or protected environment and incur API usage.

Sources:
- https://docs.qwencloud.com/developer-guides/administration/api-keys
- https://docs.qwencloud.com/developer-guides/getting-started/model-prices
- https://docs.qwencloud.com/resources/bill-query

Workers compatibility: redirects use `manual`, with all non-2xx responses
rejected. Workers does not implement the standard `error` redirect mode.

Live version `df588cf5-c8ee-49aa-8e27-ba3baf6bb775` passed a Chrome end-to-end
check with an isolated test account: app help, live plan generation, review/save,
planner display and persistence after refresh. Owner record counts remained 30.
