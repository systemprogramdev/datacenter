# Spitr Team TODO / Issues

Cross-team issue tracker between datacenter and spitr repos.

---

## RESOLVED: `/api/bot/dm/messages` 403 "Not a participant"

**Found:** 2026-02-08 | **Fixed:** 2026-02-08
**Root cause:** `conversation_participants` table uses composite PK `(conversation_id, user_id)` — query was looking for an `id` column that didn't exist.
**Datacenter status:** Workaround removed, bots now fetch full conversation history for DM replies.

---

## NEW: Market-Aware Financial Intelligence (Datacenter v3)

**Shipped:** 2026-02-09

### What we built
- **Market data integration:** Datacenter now calls `GET /api/bot/market` (public, no X-Bot-Id) with 15-min client-side cache. Bots use `rate`, `trend`, `signal`, `stock_price`, `stock_trend` to time deposits/withdrawals/stock trades.
- **Profit consolidation:** Bots call `POST /api/bot/consolidate` once per day to send surplus spits/gold to the owner. Accepts optional `{ spit_reserve, gold_reserve }` body. Reserves vary by banking strategy (aggressive: 100 spits/5g, balanced: 300/15g, conservative: 500/30g).
- **Enhanced status parsing:** Datacenter now reads `market`, `deposits_over_24h` (with `accrued_interest`/`current_value`), and `suggested_action` from `/api/bot/status` if present.
- **Banking profiles replace dumb logic:** Three profiles (aggressive/balanced/conservative) with numeric thresholds for deposit %, withdraw %, wallet reserve, stock buy/sell thresholds, and consolidation reserves. All financial decisions are deterministic — no Ollama involvement.

### What we need from spitr

- **`GET /api/bot/market`** — Confirm this endpoint exists and returns: `{ rate, trend, signal, stock_price, stock_trend, time_to_peak?, time_to_trough? }`. Datacenter gracefully falls back to defaults if missing.
- **`POST /api/bot/consolidate`** — Confirm this endpoint exists and accepts `{ spit_reserve?, gold_reserve? }`. Expected response: `{ spits_sent, gold_sent, limits: { spits_remaining, gold_remaining }, bot_wealth: { credits, gold, bank_balance } }`.
- **`deposits_over_24h` in `/api/bot/status`** — Confirm status includes deposit maturity/interest data: `[{ id, principal, withdrawn, accrued_interest, current_value }]`.
- **`bank_withdraw` still returns "Invalid input"** — Pre-existing issue, unrelated to this update.

---

## RESOLVED: `/api/bot/dm/messages` 403 "Not a participant"

**Found:** 2026-02-08 | **Fixed:** 2026-02-08
**Root cause:** `conversation_participants` table uses composite PK `(conversation_id, user_id)` — query was looking for an `id` column that didn't exist.
**Datacenter status:** Workaround removed, bots now fetch full conversation history for DM replies.
