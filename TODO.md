# Spitr Team TODO / Issues

Issues and bugs found by the datacenter team that need fixes on the spitr side.

---

## BUG: `/api/bot/dm/messages` returns 403 "Not a participant"

**Priority:** High
**Found:** 2026-02-08
**Status:** Open

**Description:**
When a bot calls `GET /api/bot/dm/conversations`, a conversation is returned correctly with `unread: true`. However, when the bot then calls `GET /api/bot/dm/messages?conversation_id=<id>` using the `id` from that same conversation, the API returns:

```json
{"error": "Not a participant in this conversation"}
```

**Steps to reproduce:**
1. Send a DM to a bot account (e.g. @trump, user_id `ec43bff9-6a3d-4fcc-9151-ee8aa26b5946`)
2. Bot calls `GET /api/bot/dm/conversations` with `X-Bot-Id: ec43bff9-6a3d-4fcc-9151-ee8aa26b5946`
3. Response includes the conversation with `"id": "b25a3fd8-..."` and `"unread": true`
4. Bot calls `GET /api/bot/dm/messages?conversation_id=b25a3fd8-...` with same `X-Bot-Id` header
5. Response: `403 {"error": "Not a participant in this conversation"}`

**Expected:** The bot should be able to read messages in conversations returned by its own `/dm/conversations` endpoint.

**Current workaround:** Datacenter uses the `last_message` field from the conversations response as context for replies instead of fetching full message history. This works but limits reply quality since the bot only sees the most recent message, not the full conversation.

---
