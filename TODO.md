# Spitr Team TODO / Issues

Cross-team issue tracker between datacenter and spitr repos.

---

## RESOLVED: `/api/bot/dm/messages` 403 "Not a participant"

**Found:** 2026-02-08 | **Fixed:** 2026-02-08
**Root cause:** `conversation_participants` table uses composite PK `(conversation_id, user_id)` — query was looking for an `id` column that didn't exist.
**Datacenter status:** Workaround removed, bots now fetch full conversation history for DM replies.

---

## RESOLVED: Market-Aware Financial Intelligence (Datacenter v3)

**Shipped:** 2026-02-09 | **Superseded by v4:** 2026-02-09

v3's custom `planFinancialAction()` with probability gates and `BANKING_PROFILES` thresholds has been replaced by the server-side financial advisor in v4. See below.

---

## NEW: Financial Advisor Integration (Datacenter v4)

**Shipped:** 2026-02-09

### What we built
- **Advisor-driven financial actions:** Datacenter now reads `financial_advisor` from `/api/bot/status` and walks the server's `priority_queue` to pick the first actionable financial move. No more client-side probability gates or custom market logic.
- **Updated MarketData fields:** Datacenter now expects `current_rate`, `current_rate_percent`, `rate_trend` (not `rate`/`trend`), and `time_to_peak_hours`/`time_to_trough_hours` (not `time_to_peak`/`time_to_trough`).
- **ActiveCD currency + rate:** CDs now carry `currency: "spit" | "gold"` and `rate: number`.
- **Updated CD API:** Buy uses `term_days` (not `term`) + `currency` param. Redeem hits separate `/bank/cd/redeem` endpoint (not `action: "redeem"` on `/bank/cd`).
- **7-day CDs as default:** Advisor recommends 7-day CDs (1.43%/day optimal). Gold CDs supported.
- **Backward compatible:** If `financial_advisor` is missing from status, bots skip financial actions and fall through to Ollama for general decisions. No crash, no broken behavior.
- **BANKING_PROFILES retained** for manual triggers (button presses in UI) and consolidation reserve thresholds.

### Advisor actions we handle
| `priority_queue[].action` | Datacenter translation |
|---|---|
| `redeem_cd` | Redeem first matured CD via `/bank/cd/redeem` |
| `convert_spits` / `convert_gold` | Convert per advisor's direction + amount |
| `buy_spit_cd` / `buy_gold_cd` | Buy 7-day CD in specified currency |
| `deposit_at_peak_rate` | Deposit using profile's depositPercent of available credits |
| `withdraw_matured_deposits` | Withdraw from first mature deposit |
| `consolidate` | Delegate to existing consolidation logic |
| `hold` | Skip (return null) |

### What we need from spitr

- **`financial_advisor` in `/api/bot/status`** — Confirm this object is present and shaped as:
  ```json
  {
    "financial_advisor": {
      "priority_queue": [{ "action": "...", "params": {}, "reasoning": "...", "priority": 1 }],
      "redeemable_cds": [{ "cd_id": "...", "amount": 100, "currency": "spit", "matured": true, "rate": 0.1, "matures_at": "..." }],
      "cd_advice": { "recommended_currency": "spit", "recommended_term_days": 7, "current_spit_rate": 0.1, "current_gold_rate": 0.08, "reasoning": "..." },
      "conversion_advice": { "direction": "spits_to_gold", "amount": 50, "reasoning": "..." } | null,
      "consolidation": { "ready": true, "spit_surplus": 500, "gold_surplus": 10 }
    }
  }
  ```
- **`GET /api/bot/market` field names** — Confirm endpoint returns `current_rate`, `current_rate_percent`, `rate_trend` (not the old `rate`/`trend`). Also `time_to_peak_hours`/`time_to_trough_hours`.
- **`POST /bank/cd/redeem`** — Confirm this is a separate endpoint (not `action: "redeem"` on `/bank/cd`). Accepts `{ cd_id: string }`.
- **`POST /bank/cd` buy** — Confirm body is `{ action: "buy", amount, term_days, currency }` (not `term`).
- **`active_cds` in status** — Confirm each CD includes `currency` and `rate` fields.

---

## RESOLVED: `/api/bot/dm/messages` 403 "Not a participant"

**Found:** 2026-02-08 | **Fixed:** 2026-02-08
**Root cause:** `conversation_participants` table uses composite PK `(conversation_id, user_id)` — query was looking for an `id` column that didn't exist.
**Datacenter status:** Workaround removed, bots now fetch full conversation history for DM replies.
