# SQL Contract — Edge Function ↔ Database

What the two edge functions call via PostgREST RPC. The SQL side (functions, tables, triggers,
pg_net calls) is implemented by the database track; this file is the binding agreement so both sides
match.

All calls are `POST {SUPABASE_URL}/rest/v1/rpc/<fn>` with JSON body
(`Content-Type: application/json`), service role auth. Return values are the function's JSON return
(PostgREST returns scalars as bare JSON values).

## 1. `submit_complaint` — called by whatsapp-intake

**Request** (all keys required, nulls allowed as marked):

```json
{
  "p_title": "No water in Bakoteh",
  "p_description": "No water since morning, whole street affected",
  "p_category_hint": "water_supply", // null if AI failed
  "p_urgency_hint": "high", // null if AI failed
  "p_lat": 13.4550, // null if no location
  "p_lng": -16.6890,
  "p_region": null,
  "p_council_area": null,
  "p_ward": null,
  "p_photo_url": "https://...", // null if no media
  "p_channel": "whatsapp",
  "p_citizen_name": "Lamin", // null if not shared
  "p_citizen_phone": "+2207123456",
  "p_is_anonymous": false,
  "p_ai_category": "water_supply", // null if AI failed
  "p_ai_urgency": "high", // null if AI failed
  "p_confidence": 0.86, // null if AI failed
  "p_external_id": "3EB0...message-id" // GOWA message id for dedupe
}
```

**Response** (JSON object):

```json
{
  "complaint_id": 123,
  "tracking_no": "GC-2026-00123",
  "institution": "nawec", // slug
  "institution_name": "NAWEC", // display name
  "department": "Water Distribution", // may be null
  "expected_response_at": "2026-10-20T09:00:00+00:00",
  "confidence": 0.86,
  "sensitive": false,
  "duplicate": false
}
```

**Behavior the SQL side must guarantee** (agreed, see API-BLUEPRINT.md):

- Idempotent on `p_external_id`: same id → same result, no second row.
- Emergency keywords override AI urgency.
- Institution/department routing from category.
- SLA deadline computed per urgency.
- Media-only reports (no caption) accepted with generated description.

## 2. `notify_out_claim` — called by notify-out

**Request**: `{"p_notification_id": 456}`

**Response**: row object or null (null = not claimable: already sent, failed permanently, or unknown
id).

```json
{
  "notification_id": 456,
  "channel": "whatsapp", // "whatsapp" | "sms"
  "recipient": "+2207123456",
  "message": "Received. Reference GC-2026-00123..."
}
```

Side effect on claim: row moves `pending → sending` (a later claim returns null).

## 3. `notify_out_result` — called by notify-out

**Request**:

```json
{
  "p_notification_id": 456,
  "p_status": "sent", // "sent" | "failed"
  "p_provider_ref": "gowa-message-id", // nullable
  "p_error": null // error text when failed
}
```

**Response**: bare `true` (returns boolean; PostgREST wraps nothing).

Side effect: `sent` → row `sending → sent` (notifications table updated with `provider_ref`,
`sent_at`); `failed` → row `sending → failed` with `error`. The DB side decides whether to schedule
a retry; the edge function never loops.

## Types

TypeScript mirrors of these shapes live in `shared/types.ts` (`SubmitComplaintArgs`,
`SubmitComplaintResult`, `ClaimRow`).
