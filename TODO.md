# Spitr Team — Bug Fixes Needed

## 1. `GET /api/bot/user/spits` returns 500

**Endpoint:** `GET /api/bot/user/spits?user_id=<uuid>&limit=5`
**Header:** `X-Datacenter-Key: <key>`
**Current response:** `{"error":"Failed to fetch spits"}` (HTTP 500)

This endpoint is called every 5 minutes by the sybil scheduler to detect when the server owner posts something new. Until it works, sybils cannot react to any posts.

**Expected response:**
```json
{
  "spits": [
    { "id": "spit-uuid", "content": "post text", "created_at": "2026-02-16T12:00:00Z" }
  ]
}
```

---

## 2. `GET /api/bot/status` returns 404 for sybil accounts

**Endpoint:** `GET /api/bot/status`
**Header:** `X-Datacenter-Key: <key>`, `X-Bot-Id: <sybil-user-id>`
**Current response:** `{"error":"Bot not found"}` (HTTP 404)

The status endpoint doesn't recognize sybil user accounts. It likely only checks for `account_type = 'bot'` — needs to also accept `account_type = 'sybil'`.

**Expected behavior:** Return the same status payload as regular bots (hp, destroyed, etc.) so the datacenter can health-check sybils and mark dead ones.
