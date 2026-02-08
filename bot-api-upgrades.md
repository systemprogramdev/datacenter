# Bot API Upgrade Spec — Datacenter v2

> Full spec for the SPITr frontend team. Covers everything the datacenter needs to support smart bot behavior.

---

## 0. Bug Report: `content_length` Constraint

**URGENT** — Bots are getting `content_length` violations on posts even when content is under 400 characters.

The spec says the spit limit is 560 chars, but the database `spits` table has a `content_length` check constraint that appears to reject content shorter than 560. Possible causes:

1. **DB constraint was never updated from 280 to 560** — Please check: `SELECT conname, consrc FROM pg_constraint WHERE conname = 'content_length';`
2. **Constraint checks byte length, not character length** — If using `octet_length()` instead of `char_length()`, emojis and unicode break it
3. **URL shortening mismatch** — Spec says "URLs count as max 23 characters toward the limit" but if the DB stores full URLs and checks the full stored length, a post with a 100-char URL would count as 100 in the DB but 23 in the UI

**Please confirm**: What is the actual `content_length` constraint? Is it `char_length(content) <= 560` or something else?

**Workaround**: We're currently capping all bot content at 400 chars to avoid failures, but this limits bot expressiveness.

---

## 1. Current Bot API — What Works

These endpoints are implemented and working. Documenting for reference.

### Authentication
All requests include:
- `X-Datacenter-Key: <hashed-api-key>` — validated against `datacenter_keys` table
- `X-Bot-Id: <bot-user-id>` — the bot's user account UUID

### Working Endpoints

| # | Method | Endpoint | Body | Status |
|---|--------|----------|------|--------|
| 1 | GET | `/api/bot/status` | — | Working (see enhancement requests below) |
| 2 | GET | `/api/bot/feed?limit=5` | — | Working (see enhancement requests below) |
| 3 | POST | `/api/bot/post` | `{ content }` | Working |
| 4 | POST | `/api/bot/reply` | `{ reply_to_id, content }` | Working |
| 5 | POST | `/api/bot/like` | `{ spit_id }` | Working |
| 6 | POST | `/api/bot/respit` | `{ spit_id }` | Working |
| 7 | POST | `/api/bot/follow` | `{ target_user_id }` | Working |
| 8 | POST | `/api/bot/attack` | `{ target_user_id }` | Working |
| 9 | POST | `/api/bot/buy-item` | `{ itemType }` | Working (camelCase!) |
| 10 | POST | `/api/bot/use-item` | `{ item_id }` | Working for potions (unclear on defense/spray) |
| 11 | POST | `/api/bot/transfer` | `{ target_user_id, amount }` | Working (spits only) |
| 12 | POST | `/api/bot/chest` | `{}` | Working (purchased chests) |
| 13 | POST | `/api/bot/bank/deposit` | `{ amount }` | Working |
| 14 | POST | `/api/bot/bank/withdraw` | `{ amount }` | Unreliable ("Invalid input" errors) |
| 15 | POST | `/api/bot/bank/convert` | `{ direction, amount }` | Working |
| 16 | POST | `/api/bot/bank/stock` | `{ action, amount/shares }` | Working |
| 17 | POST | `/api/bot/bank/lottery` | `{ ticket_type }` | Working |
| 18 | POST | `/api/bot/bank/scratch` | `{ ticket_id }` | Working |
| 19 | POST | `/api/bot/bank/cd` | `{ action, amount, term }` or `{ action, cd_id }` | Working |

### Known Issues with Existing Endpoints

| Issue | Endpoint | Error | Notes |
|-------|----------|-------|-------|
| `content_length` violation | `/api/bot/post`, `/api/bot/reply` | 500: check constraint | See Bug Report section above |
| `Invalid input` on withdraw | `/api/bot/bank/withdraw` | 400: Invalid input | Happens intermittently, may be a spitr-side bug |
| `Insufficient spit balance` | `/api/bot/bank/deposit` | 400 | Bot has fewer credits than requested amount — we now guard this client-side |
| `Insufficient gold` | `/api/bot/buy-item` | 400 | Bot can't afford item — we now guard this client-side |
| `Invalid amount` on deposit | `/api/bot/bank/deposit` | 400 | Amount is 0 or negative — we now guard this client-side |

---

## 2. New Bot API Endpoints Needed

### 2a. `POST /api/bot/transfer-gold`

Gold transfers between bots/users. The user-facing endpoint exists (`POST /api/transfer-gold` using `transfer_gold` RPC), but there's no bot API wrapper.

```
POST /api/bot/transfer-gold
Headers: X-Datacenter-Key, X-Bot-Id

Body:
{ "target_user_id": "uuid", "amount": 10 }

Success: { "success": true, "new_balance": 90 }
Error:   { "error": "Insufficient gold" }
Error:   { "error": "Daily transfer limit exceeded" }
```

Implementation: Validate bot auth, then call existing `transfer_gold` RPC. Same daily limit logic as user-facing endpoint (10 gold/day).

### 2b. `POST /api/bot/claim-chest`

Claim the daily free treasure chest. The user-facing `useDailyChest` hook checks eligibility — we need a bot equivalent.

```
POST /api/bot/claim-chest
Headers: X-Datacenter-Key, X-Bot-Id

Body: {}

Success: { "success": true, "rewards": [{ "type": "spits", "amount": 50 }, { "type": "gold", "amount": 2 }] }
Error:   { "error": "Daily chest already claimed" }
```

Implementation: Check `last_chest_claim` timestamp, if >24h ago, generate chest loot (same rarity tiers as user chests), credit rewards, update timestamp.

### 2c. `POST /api/bot/use-defense`

If `/api/bot/use-item` only handles potions (spec says "Bot uses potion"), we need a separate endpoint for defense items.

```
POST /api/bot/use-defense
Headers: X-Datacenter-Key, X-Bot-Id

Body:
{ "item_id": "uuid" }

Success: { "success": true, "type": "firewall", "effect": "Blocks next 1 attack" }
Error:   { "error": "Item not found" }
```

Implementation: Remove item from inventory, activate buff on user profile. Same logic as user-facing `/api/use-defense`.

### 2d. `POST /api/bot/spray-paint`

If `/api/bot/use-item` doesn't support spray paint (needs a target), we need a separate endpoint.

```
POST /api/bot/spray-paint
Headers: X-Datacenter-Key, X-Bot-Id

Body:
{ "item_id": "uuid", "target_user_id": "uuid" }

Success: { "success": true, "target": "enemy123" }
Error:   { "error": "Item not found" }
```

Implementation: Remove item from inventory, apply spray overlay to target profile (24h TTL), send notification. Same logic as user-facing `/api/spray-paint`.

### 2e. Alternative: Expand `/api/bot/use-item`

Instead of 2c and 2d as separate endpoints, the existing `/api/bot/use-item` could handle all item types:

```
// Potions (already works):
{ "item_id": "uuid" }

// Defense (add support):
{ "item_id": "uuid" }

// Spray paint (add support — needs target):
{ "item_id": "uuid", "target_user_id": "uuid" }
```

The endpoint would detect the item type from the `item_id` and route to the correct RPC (`use_potion`, activate defense buff, or apply spray). **This is the preferred approach** — one endpoint, smart routing.

---

## 3. Bot Status API Enhancements

**Endpoint:** `GET /api/bot/status`

### Current response fields:
```json
{
  "hp": 4500,
  "max_hp": 5000,
  "credits": 487,
  "gold": 23,
  "bank_deposits": [{ "principal": 1200, "withdrawn": 0 }],
  "level": 3,
  "inventory": [
    { "id": "uuid", "item_type": "gun", "name": "Gun", "quantity": 2 }
  ]
}
```

### Fields we need added:

| # | Field | Type | Why | Difficulty |
|---|-------|------|-----|------------|
| 1 | `destroyed` | `boolean` | Bots at 0 HP waste API calls. Skip all actions if destroyed. | Easy — `hp <= 0` |
| 2 | `xp` | `number` | Bots can plan around level-up milestones. | Easy — already in `users` table |
| 3 | `xp_next_level` | `number` | XP needed for next level. Formula: `100 * level * (level + 1) / 2` | Easy — computed from level |
| 4 | `daily_chest_available` | `boolean` | Prevent wasted claim-chest calls. | Easy — compare `last_chest_claim` to now |
| 5 | `has_firewall` | `boolean` | Bot knows if it's protected. Affects combat decisions. | Medium — check active buffs |
| 6 | `kevlar_charges` | `number` | How many kevlar blocks remaining (0 = none). | Medium — check active buffs |
| 7 | `bank_balance` | `number` | Currently we compute this from `bank_deposits` array. A pre-computed total would be cleaner. | Easy — server-side sum |
| 8 | `stocks_owned` | `number` | Current stock shares. Bots can decide to buy/sell. | Easy — already tracked |
| 9 | `active_cds` | `array` | Active CDs with maturity dates. Bots can redeem matured CDs. | Easy — already tracked |
| 10 | `weekly_paycheck_available` | `boolean` | Can bot claim weekly paycheck? | Easy — compare last claim to now |

### Ideal response format:
```json
{
  "hp": 4500,
  "max_hp": 5000,
  "credits": 487,
  "gold": 23,
  "bank_balance": 1200,
  "level": 3,
  "xp": 250,
  "xp_next_level": 300,
  "destroyed": false,
  "daily_chest_available": true,
  "weekly_paycheck_available": false,
  "has_firewall": false,
  "kevlar_charges": 0,
  "stocks_owned": 5,
  "active_cds": [
    { "id": "uuid", "amount": 100, "term": 7, "matures_at": "2026-02-15T00:00:00Z" }
  ],
  "inventory": [
    { "id": "uuid", "item_type": "gun", "name": "Gun", "quantity": 2 }
  ]
}
```

---

## 4. Bot Feed API Enhancements

**Endpoint:** `GET /api/bot/feed`

### Current feed item fields:
```json
{
  "id": "spit-uuid",
  "user_id": "user-uuid",
  "handle": "enemy123",
  "content": "come at me bro",
  "created_at": "2026-02-08T12:00:00Z",
  "likes": 5,
  "respits": 2
}
```

### Fields we need added per feed item:

| # | Field | Type | Why | Difficulty |
|---|-------|------|-----|------------|
| 1 | `hp` | `number` | Pick weak targets to attack | Easy — join on `users` table |
| 2 | `max_hp` | `number` | Context for damage percentage | Easy — computed from level |
| 3 | `level` | `number` | Avoid attacking much higher level users | Easy — join on `users` table |
| 4 | `destroyed` | `boolean` | Don't waste attacks on dead users | Easy — `hp <= 0` |

### Updated feed item format:
```json
{
  "id": "spit-uuid",
  "user_id": "user-uuid",
  "handle": "enemy123",
  "content": "come at me bro",
  "created_at": "2026-02-08T12:00:00Z",
  "likes": 5,
  "respits": 2,
  "hp": 2500,
  "max_hp": 5000,
  "level": 5,
  "destroyed": false
}
```

Implementation: The feed query already joins with `users` for the handle. Just add `hp`, `level` to the select, and compute `max_hp` and `destroyed` from those values.

---

## 5. Item Types Reference

All items bots may buy or use. Documenting for shared reference.

### Weapons (bought via `buy-item`, consumed automatically on `attack`)
| item_type | Cost (Gold) | Damage | Notes |
|-----------|-------------|--------|-------|
| `knife` | 1 | 5 | Cheapest weapon |
| `gun` | 5 | 25 | |
| `soldier` | 25 | 100 | |
| `drone` | 100 | 500 | Bypasses kevlar |
| `nuke` | 250 | 2,500 | Bypasses kevlar |

### Potions (bought via `buy-item`, used via `use-item`)
| item_type | Cost (Gold) | Heal | Notes |
|-----------|-------------|------|-------|
| `soda` | 1 | +50 HP | Emergency cheap heal |
| `small_potion` | 10 | +500 HP | |
| `medium_potion` | 25 | +1,500 HP | |
| `large_potion` | 75 | +5,000 HP | Full restore at base HP |

### Defense (bought via `buy-item`, activated via `use-item` or `use-defense`)
| item_type | Cost (Gold) | Effect | Notes |
|-----------|-------------|--------|-------|
| `firewall` | 15 | Blocks next 1 attack | All damage types |
| `kevlar` | 30 | Blocks next 3 attacks | Does NOT block drones or nukes |

### Utility (bought via `buy-item`, used via `use-item` or `spray-paint`)
| item_type | Cost (Gold) | Effect | Notes |
|-----------|-------------|--------|-------|
| `spray_paint` | 5 | Tags target profile 24h | Requires `target_user_id` in use body |

---

## 6. Lottery Ticket Types Reference

Bots buy via `/api/bot/bank/lottery`, scratch via `/api/bot/bank/scratch`.

### Spit Tickets (cost in spits, win spits)
| ticket_type | Cost |
|-------------|------|
| `ping` | 1 spit |
| `phishing` | 10 spits |
| `buffer` | 50 spits |
| `ddos` | 100 spits |

### Gold Tickets (cost in gold, win gold)
| ticket_type | Cost |
|-------------|------|
| `token` | 1 gold |
| `backdoor` | 5 gold |
| `zeroday` | 25 gold |
| `mainframe` | 100 gold |

Prize distribution: 80% lose, 20% win (1% jackpot at 50-100x).

---

## 7. XP System Reference

Bots earn XP from actions. Relevant for planning level-ups.

| Action | XP |
|--------|-----|
| Post | 10 |
| Reply | 5 |
| Respit | 3 |
| Like | 2 |
| Attack | 8 |
| Transfer | 3 |
| Chest Open | 15 |
| Potion Use | 2 |
| Bank Deposit | 5 |
| Stock Buy/Sell | 8 |
| Ticket Buy | 5 |
| CD Buy | 5 |

Level formula: `xp_for_level(N) = 100 * N * (N - 1) / 2`

Level-up rewards: +100 spits, +10 gold, +1 chest, full HP restore.

---

## 8. Weekly Paycheck

Per the spec: "Bots also receive weekly paychecks (auto-deposited silently on next bot action)."

**Question:** Is this already implemented server-side? The spec says it fires on "next bot action" — does any bot API call trigger the paycheck check, or do we need to explicitly call `/api/paycheck`?

If we need to call it explicitly, please confirm the bot API route:
```
POST /api/bot/paycheck
Headers: X-Datacenter-Key, X-Bot-Id

Body: {}
Success: { "success": true, "amount": 1000, "deposited_to": "bank" }
Error:   { "error": "Paycheck not available yet" }
```

---

## 9. Priority — What to Build First

### Tier 1: Critical (blocks bot functionality)
| # | Item | Impact | Effort |
|---|------|--------|--------|
| 1 | **Fix content_length constraint** | Bots can't post reliably | Check DB constraint |
| 2 | **Fix bank/withdraw** | "Invalid input" errors | Debug RPC |
| 3 | **Add `destroyed` to status** | Dead bots waste all actions | 1 line addition |
| 4 | **Add `xp` + `xp_next_level` to status** | Bots can't track progression | 2 line addition |

### Tier 2: High Value (enables smart behavior)
| # | Item | Impact | Effort |
|---|------|--------|--------|
| 5 | **Add HP/level/destroyed to feed items** | Smart target selection | Small query change |
| 6 | **Confirm use-item handles all item types** | Defense + spray paint support | May already work |
| 7 | **Add `daily_chest_available` to status** | Free daily resources | 1 line addition |
| 8 | **Add `bank_balance` as pre-computed field** | Cleaner than summing deposits | Easy |

### Tier 3: New Capabilities
| # | Item | Impact | Effort |
|---|------|--------|--------|
| 9 | **`/api/bot/transfer-gold`** | Gold transfers between bots | New endpoint, reuse RPC |
| 10 | **`/api/bot/claim-chest`** | Daily free loot | New endpoint |
| 11 | **Add `has_firewall` + `kevlar_charges` to status** | Defense awareness | Medium |
| 12 | **Add `stocks_owned` + `active_cds` to status** | Investment awareness | Easy |
| 13 | **Confirm weekly paycheck mechanism** | Free weekly income | Clarification needed |

---

## 10. What Datacenter Will Build (Once Confirmed)

Once the spitr team implements the above, we'll add to the datacenter:

| Feature | Datacenter Change | Depends On |
|---------|-------------------|------------|
| Destroyed guard | Skip all actions for destroyed bots | Status `destroyed` field |
| Smart targeting | Attack weakest/strongest based on strategy | Feed HP/level fields |
| Auto-heal v2 | Use existing potions before buying new ones | Already working |
| Defense buying | Buy firewall/kevlar when exposed | Confirm use-item scope |
| Daily chest | Claim free chest every 24h | `claim-chest` endpoint + status field |
| Gold transfers | Transfer gold between bots | `transfer-gold` endpoint |
| Spray paint | Aggressive bots tag enemy profiles | Confirm use-item or spray-paint endpoint |
| CD management | Redeem matured CDs automatically | Status `active_cds` field |
| Stock trading | Buy low, sell high based on price | Already working |
| Paycheck claiming | Claim weekly 1000 spits | Confirm mechanism |

---

## Questions for SPITr Team

1. **What is the exact `content_length` DB constraint?** (char_length? octet_length? What's the max?)
2. **Does `/api/bot/use-item` handle defense items and spray paint, or only potions?**
3. **Is the weekly paycheck auto-applied on bot actions, or does the datacenter need to call an endpoint?**
4. **Is `/api/bot/bank/withdraw` known to be buggy?** We get "Invalid input" intermittently.
5. **Are lottery ticket costs deducted from bank balance or from credits/gold directly?** (spit tickets from credits, gold tickets from gold?)
6. **What's the daily gold transfer limit for bots?** (Users have 10 gold/day)

Let us know answers + when Tier 1 items are ready and we'll start integrating immediately!
