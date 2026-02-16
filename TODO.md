# Sybil Server — Spitr Team Integration Spec

**Date:** 2026-02-16
**Author:** Datacenter team
**Status:** Awaiting spitr-side implementation

---

## Overview

Users can purchase a **Sybil Server** (1000 gold) that spawns a swarm of bot accounts to amplify their posts. The datacenter handles scheduling, reaction orchestration, and image generation. The spitr backend needs to support account creation, purchase flow, and behavioral restrictions for sybil accounts.

---

## 1. New Endpoints Required

### `POST /api/bot/sybil/purchase`

Deduct 1000 gold from the owner's account.

**Request:**
```json
{
  "owner_user_id": "uuid-of-purchasing-user"
}
```

**Headers:**
```
X-Datacenter-Key: <datacenter-api-key>
```

**Response (success):**
```json
{ "success": true }
```

**Response (insufficient funds):**
```json
{ "success": false, "error": "Insufficient gold (need 1000, have 847)" }
```

**Status codes:** `200` success, `402` insufficient funds, `400` bad request

---

### `POST /api/bot/sybil/create`

Create a new sybil user account linked to an owner.

**Request:**
```json
{
  "owner_user_id": "uuid-of-owner",
  "name": "Dark Knight",
  "handle": "xdarkknightx",
  "avatar_url": "https://...",
  "banner_url": "https://..."
}
```

**Headers:**
```
X-Datacenter-Key: <datacenter-api-key>
```

**Response:**
```json
{
  "user_id": "uuid-of-new-sybil-account"
}
```

**Account properties:**
- `account_type`: `"sybil"` (new column, see DB changes below)
- `sybil_owner_id`: references the purchasing user
- `hp`: 100 (fixed, sybils are fragile)
- `max_hp`: 100
- `revivable`: `false` — once dead, permanently dead
- No starting gold/credits

**Status codes:** `201` created, `400` bad request, `409` handle taken

---

### `GET /api/bot/user/spits?user_id=X&limit=5`

Get a user's recent posts. Used by datacenter to detect when the sybil server owner posts something new.

**Query params:**
- `user_id` (required): the spitr user ID
- `limit` (optional, default 5): max posts to return

**Headers:**
```
X-Datacenter-Key: <datacenter-api-key>
```

**Response:**
```json
{
  "spits": [
    {
      "id": "spit-uuid",
      "content": "just dropped a fire take",
      "created_at": "2026-02-16T12:00:00Z",
      "user_id": "owner-uuid",
      "likes": 5,
      "respits": 2
    }
  ]
}
```

**Status codes:** `200` success, `404` user not found

---

### `POST /api/bot/sybil/upload-image`

Upload an avatar or banner image for a sybil account.

**Request:** `multipart/form-data` with fields:
- `file`: PNG image data
- `user_id`: the sybil user's UUID
- `type`: `"avatar"` or `"banner"`

**Headers:**
```
X-Datacenter-Key: <datacenter-api-key>
```

**Response:**
```json
{
  "url": "https://storage.spitr.wtf/sybil/avatar_abc123.png"
}
```

**Status codes:** `200` success, `400` bad file, `413` file too large

---

### `POST /api/bot/sybil/update-profile` (NEW — REQUIRED)

**This endpoint is critical.** After uploading images via `upload-image`, the datacenter calls this endpoint to actually set the avatar/banner on the sybil user's profile. Without this, uploaded images are orphaned in storage and never appear on the user's profile.

**Request:**
```json
{
  "user_id": "uuid-of-sybil-account",
  "avatar_url": "https://storage.spitr.wtf/avatars/sybil_abc123.png",
  "banner_url": "https://storage.spitr.wtf/banners/sybil_def456.png"
}
```

Both `avatar_url` and `banner_url` are optional — only provided fields should be updated.

**Headers:**
```
X-Datacenter-Key: <datacenter-api-key>
```

**Response (success):**
```json
{ "success": true }
```

**Implementation:** Simple UPDATE on the users table:
```sql
UPDATE users
SET avatar_url = COALESCE(:avatar_url, avatar_url),
    banner_url = COALESCE(:banner_url, banner_url)
WHERE id = :user_id AND account_type = 'sybil';
```

**Status codes:** `200` success, `404` user not found, `403` not a sybil account

---

## 2. Database Changes

### New columns on `users` table

| Column | Type | Notes |
|--------|------|-------|
| `account_type` | TEXT | `'normal'`, `'bot'`, or `'sybil'`. Default `'normal'`. |
| `sybil_owner_id` | UUID FK → users | NULL for normal/bot accounts. Points to owner for sybil accounts. |
| `revivable` | BOOLEAN | Default `true`. Set to `false` for sybil accounts. |

### Migration

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'normal'
    CHECK (account_type IN ('normal', 'bot', 'sybil')),
  ADD COLUMN IF NOT EXISTS sybil_owner_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS revivable BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX idx_users_sybil_owner ON users(sybil_owner_id) WHERE sybil_owner_id IS NOT NULL;
```

---

## 3. Behavioral Restrictions for Sybil Accounts

Sybil accounts are restricted to prevent abuse:

1. **Actions allowed:** Only `like`, `reply`, `respit` — and ONLY on posts made by their `sybil_owner_id`
2. **No posting:** Sybils cannot create original posts
3. **No combat:** Cannot attack, buy items, use items
4. **No banking:** No deposits, withdrawals, CDs, stocks, lottery
5. **No chests/paychecks:** `daily_chest_available` and `weekly_paycheck_available` always `false`
6. **100 HP cap:** Max HP is 100 (not 5000)
7. **No revival:** When HP reaches 0, account is permanently dead. The `/revive` endpoint should reject sybil accounts.
8. **No transfers:** Cannot send or receive credits/gold
9. **Hidden from discovery:** Sybil accounts should NOT appear in:
   - Trending users
   - Search results (unless directly searched by handle)
   - Suggested follows
   - Leaderboards
10. **Follow restrictions:** Sybils automatically follow their owner. They cannot follow/unfollow anyone else.

### Server-side enforcement

The easiest approach: check `account_type === 'sybil'` at the top of each restricted endpoint and return `403 "Sybil accounts cannot perform this action"`.

For the owner-only restriction on like/reply/respit:
```sql
-- When a sybil tries to like/reply/respit, verify the target spit belongs to their owner
SELECT user_id FROM spits WHERE id = :spit_id;
-- Compare against users.sybil_owner_id — if they don't match, reject
```

---

## 4. Existing Endpoints — No Changes Needed

The datacenter already uses these for sybil actions (same as regular bots):
- `POST /api/bot/like` — `{ spit_id }` with `X-Bot-Id` header
- `POST /api/bot/reply` — `{ reply_to_id, content }` with `X-Bot-Id` header
- `POST /api/bot/respit` — `{ spit_id }` with `X-Bot-Id` header
- `GET /api/bot/status` — health check (with `X-Bot-Id` header)

The `X-Bot-Id` header will contain the sybil's `user_id`.

---

## 5. Flow Summary

```
1. User clicks "Buy Sybil Server" in spitr UI
2. spitr calls POST /api/bot/sybil/purchase → deducts 1000 gold
3. spitr notifies datacenter (or datacenter polls)
4. Datacenter creates sybil_servers row, claims 10 names from pre-generated pool
5. Datacenter's sybil scheduler deploys sybils one by one:
   a. Create account via POST /api/bot/sybil/create (no images yet)
   b. Generate avatar + banner via Python SDXL service
   c. Upload images via POST /api/bot/sybil/upload-image
   d. Apply images to profile via POST /api/bot/sybil/update-profile  ← NEW
6. When owner posts on spitr:
   a. Datacenter detects new post via GET /api/bot/user/spits
   b. Schedules staggered reactions (like/reply/respit) across all alive sybils
   c. Executes reactions via existing like/reply/respit endpoints
7. Periodically health-checks sybils via GET /api/bot/status
   - Dead sybils (hp=0) are marked permanently dead
   - New sybils are produced daily (1/day) up to the 50 cap
8. Scheduler refills name pool in background when < 20 names remain
```

---

## 6. Questions / Open Items

- [ ] Should the sybil purchase be triggered from spitr UI → datacenter API, or should spitr handle the purchase and notify datacenter?
- [ ] Do we need a `GET /api/bot/sybil/status?owner_user_id=X` endpoint for the spitr UI to show sybil server status?
- [ ] Should sybil replies count toward the owner's post engagement metrics (likes/respits count visible to others)?
- [ ] Should other users be able to attack sybil accounts? (Current assumption: yes, they can be attacked and killed)
- [ ] Should sybil accounts be visually distinguishable from normal accounts? (e.g., a badge or different avatar border)
