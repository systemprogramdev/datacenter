# Spitr Team TODO / Issues

Cross-team issue tracker between datacenter and spitr repos.

---

## RESOLVED: `/api/bot/dm/messages` 403 "Not a participant"

**Found:** 2026-02-08 | **Fixed:** 2026-02-08
**Root cause:** `conversation_participants` table uses composite PK `(conversation_id, user_id)` — query was looking for an `id` column that didn't exist.
**Datacenter status:** Workaround removed, bots now fetch full conversation history for DM replies.

---

*No open issues at this time.*
