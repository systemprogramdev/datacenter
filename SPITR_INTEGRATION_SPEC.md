# SPITr Datacenter Integration Spec

## Overview

Build the spitr-side integration for the Datacenter bot management system. This includes:
1. **Bot purchase system** (new section in the shop OR new `/datacenter` page)
2. **Bot API endpoints** (so the datacenter server can execute actions on behalf of bots)
3. **Bot management UI** (so users can configure their bots after purchase)

The datacenter is a separate Next.js app running on another machine that orchestrates AI-driven bots via Ollama LLM. It calls spitr's API to execute bot actions. Bots cost **1000 spits OR 100 gold**.

---

## DATABASE TABLES (ALREADY CREATED IN SUPABASE)

These tables already exist - the SQL migration has been run. Your code just needs to read/write to them.

```sql
-- bots: core bot registration
bots (
  id UUID PRIMARY KEY,
  owner_id UUID REFERENCES users(id),   -- the user who bought the bot
  user_id UUID REFERENCES users(id),    -- the bot's own user account
  name TEXT,
  handle TEXT UNIQUE,
  personality TEXT DEFAULT 'neutral',
  action_frequency INT DEFAULT 3,       -- 1-3 actions per day
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

-- bot_configs: per-bot strategy settings
bot_configs (
  bot_id UUID PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  enabled_actions TEXT[],
  target_mode TEXT,          -- 'random'|'specific'|'allies'|'enemies'
  target_users UUID[],
  combat_strategy TEXT,      -- 'aggressive'|'defensive'|'passive'|'balanced'
  banking_strategy TEXT,     -- 'aggressive'|'conservative'|'balanced'
  auto_heal_threshold INT DEFAULT 1000,
  custom_prompt TEXT,
  updated_at TIMESTAMPTZ
)

-- bot_jobs: action history (read-only on spitr side, written by datacenter)
bot_jobs (
  id UUID PRIMARY KEY,
  bot_id UUID REFERENCES bots(id),
  action_type TEXT,
  action_payload JSONB,
  status TEXT,              -- 'pending'|'running'|'completed'|'failed'
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ
)

-- bot_daily_actions: tracks actions used per day
bot_daily_actions (bot_id UUID, action_date DATE, actions_used INT)

-- datacenter_keys: API key authentication
datacenter_keys (
  id UUID PRIMARY KEY,
  key_hash TEXT UNIQUE,
  label TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ
)
```

There's also an RPC function `increment_daily_actions(p_bot_id UUID, p_date DATE)` already created.

---

## TASK 1: Bot Purchase Flow

### Pricing
- **1000 spits** (credits) OR **100 gold** - user picks which currency
- Each purchase creates a new user account for the bot + inserts into `bots` and `bot_configs`

### Where to put it
Add a new page at `src/app/(main)/datacenter/page.tsx`. This is the bot marketplace and management hub.

### Purchase logic (follows existing shop patterns)

The purchase flow should work like this:

1. User clicks "Buy Bot" and picks a payment method (spits or gold)
2. User fills in bot name + handle
3. Backend creates a new auth user for the bot (via supabaseAdmin)
4. Backend creates entries in `users`, `user_credits`, `user_gold`, `user_xp` for the bot account
5. Backend inserts into `bots` table (owner_id = buyer, user_id = new bot user)
6. Backend inserts default `bot_configs` row
7. Deduct cost from buyer

### API Route: `POST /api/bot/purchase`

Create at `src/app/api/bot/purchase/route.ts`:

```typescript
// Request body:
{
  name: string,           // bot display name
  handle: string,         // bot handle (unique)
  personality: string,    // 'neutral'|'aggressive'|'friendly'|'chaotic'|'intellectual'|'troll'
  payment_method: 'spits' | 'gold'
}

// Auth: standard supabase auth (user must be logged in)
// Cost: 1000 spits OR 100 gold

// Steps:
// 1. Validate user is authenticated
// 2. Check handle uniqueness (query users table)
// 3. Check buyer has sufficient balance
// 4. Create bot user account via supabaseAdmin.auth.admin.createUser()
//    - Use a generated email like `bot_${handle}@spitr.bot`
//    - Random password (bots don't login)
// 5. Insert into `users` table: { id: newUserId, handle, name, hp: 5000 }
// 6. Insert into `user_credits`: { user_id: newUserId, balance: 0 }
// 7. Insert into `user_gold`: { user_id: newUserId, balance: 0 }
// 8. Insert into `user_xp`: { user_id: newUserId, xp: 0, level: 1 }
// 9. Insert into `bots`: { owner_id: buyer.id, user_id: newUserId, name, handle, personality }
// 10. Insert into `bot_configs`: { bot_id: newBotId, ...defaults }
// 11. Deduct from buyer:
//     - If spits: update user_credits, log to credit_transactions with type 'bot_purchase'
//     - If gold: update user_gold, log to gold_transactions with type 'bot_purchase'
// 12. Return the created bot

// Response:
{ success: true, bot: { id, name, handle, personality, ... } }
```

**Important**: Use `supabaseAdmin` (service role) for creating the bot user and all inserts. Use the authenticated user's session only to verify identity and check balance.

You'll need to add `'bot_purchase'` as a valid transaction type. Since the existing code doesn't use strict DB enums for transaction types (they're just text columns), this should work by just inserting the string.

---

## TASK 2: Datacenter Page UI

### Page: `src/app/(main)/datacenter/page.tsx`

This page has two sections:

#### Section 1: Buy a Bot
- Show pricing: "1000 ⭐ or 100 🪙"
- Form fields: Bot Name, Handle, Personality (dropdown)
- Two buy buttons: "Buy with Spits" / "Buy with Gold"
- Use the same hooks: `useCredits()` for spits, `useGold()` for gold
- On success, refresh the bot list below

#### Section 2: My Bots
- Query `bots` table where `owner_id = current_user.id`
- Join with `bot_configs` using `select("*, config:bot_configs(*)")`
- For each bot show: name, handle, personality, active status, action_frequency
- Toggle active/inactive (PATCH to `/api/bot/[id]/config`)
- Edit config: personality, combat_strategy, banking_strategy, target_mode, auto_heal_threshold, custom_prompt
- Show recent jobs from `bot_jobs` table (last 5, read-only)

### API Routes for bot management:

**GET `/api/bot/my-bots`** - Returns all bots owned by the authenticated user
```typescript
// Auth: supabase auth
// Query: bots where owner_id = user.id, join bot_configs
```

**PATCH `/api/bot/[id]/config`** - Update bot config
```typescript
// Auth: supabase auth, verify user owns this bot (owner_id = user.id)
// Body: { personality?, action_frequency?, combat_strategy?, banking_strategy?, target_mode?, auto_heal_threshold?, custom_prompt?, is_active? }
// Update bots table and/or bot_configs table
```

### Add nav link
Add "Datacenter" to the main navigation (wherever the nav links are defined, probably in a layout or sidebar component). Use a robot emoji or circuit icon.

---

## TASK 3: Bot Action API Endpoints

These are called by the external datacenter server (NOT by users). They authenticate via `X-Datacenter-Key` header instead of user sessions.

### Shared middleware pattern

Every `/api/bot/*` endpoint (except `/api/bot/purchase` and `/api/bot/my-bots` which use user auth) should:

```typescript
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// In each route handler:
async function validateBotRequest(request: NextRequest) {
  const dcKey = request.headers.get('X-Datacenter-Key')
  const botId = request.headers.get('X-Bot-Id')

  if (!dcKey || !botId) {
    return { error: 'Missing datacenter key or bot ID', status: 401 }
  }

  // Validate the API key
  // The datacenter_keys table stores SHA-256 hashes of the raw keys
  const crypto = require('crypto')
  const keyHash = crypto.createHash('sha256').update(dcKey).digest('hex')
  const { data: keyRow } = await supabaseAdmin
    .from('datacenter_keys')
    .select('id')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (!keyRow) {
    return { error: 'Invalid datacenter key', status: 401 }
  }

  // Verify bot exists
  const { data: bot } = await supabaseAdmin
    .from('bots')
    .select('id, user_id, owner_id, name, handle, is_active')
    .eq('user_id', botId)
    .single()

  if (!bot || !bot.is_active) {
    return { error: 'Bot not found or inactive', status: 404 }
  }

  return { bot, botUserId: bot.user_id }
}
```

### Endpoints to create

All under `src/app/api/bot/`:

#### `GET /api/bot/status/route.ts`
Returns bot's current game state for LLM context.
```typescript
// Headers: X-Datacenter-Key, X-Bot-Id
// Returns: { hp, max_hp, credits, gold, bank_balance, level, inventory[] }
// Query: users (hp), user_credits (balance), user_gold (balance),
//         user_xp (level), user_inventory (items), bank_deposits (sum)
```

#### `GET /api/bot/feed/route.ts`
Returns recent spits for LLM to read and decide what to do.
```typescript
// Headers: X-Datacenter-Key, X-Bot-Id
// Query param: ?limit=5
// Returns: array of { id, user_id, handle, content, created_at, likes, respits }
// Query: spits joined with users, ordered by created_at desc, limit 5
```

#### `POST /api/bot/post/route.ts`
Create a spit as the bot.
```typescript
// Headers: X-Datacenter-Key, X-Bot-Id
// Body: { content: string }
// Logic: Insert into spits table with user_id = bot's user_id
//        Deduct 1 credit from bot's user_credits
//        Log credit_transaction
```

#### `POST /api/bot/reply/route.ts`
```typescript
// Body: { spit_id: string, content: string }
// Logic: Insert spit with reply_to_id, deduct 1 credit, create notification
```

#### `POST /api/bot/like/route.ts`
```typescript
// Body: { spit_id: string }
// Logic: Insert into likes table, deduct 1 credit, create notification
```

#### `POST /api/bot/respit/route.ts`
```typescript
// Body: { spit_id: string }
// Logic: Insert into respits table, deduct 1 credit, create notification
```

#### `POST /api/bot/attack/route.ts`
```typescript
// Body: { target_id: string }
// Logic: Pick a weapon from bot's inventory, call perform_attack RPC
//        Same logic as existing /api/attack but using supabaseAdmin
//        with the bot's user_id as attacker
```

#### `POST /api/bot/use-item/route.ts`
```typescript
// Body: { item_id: string }  (item_type like 'small_potion')
// Logic: Same as /api/use-potion or /api/use-defense depending on item category
```

#### `POST /api/bot/bank/deposit/route.ts`
```typescript
// Body: { amount: number }
// Logic: Same as /api/bank/deposit but with bot's user_id
```

#### `POST /api/bot/bank/withdraw/route.ts`
```typescript
// Body: { amount: number }
// Logic: Same as /api/bank/withdraw but with bot's user_id
```

#### `POST /api/bot/buy-item/route.ts`
```typescript
// Body: { item_type: string }
// Logic: Look up gold cost from ITEMS array, deduct gold, upsert inventory
```

#### `POST /api/bot/chest/route.ts`
```typescript
// Body: {}
// Logic: Buy chest (100 credits) + open it, return loot
```

#### `POST /api/bot/follow/route.ts`
```typescript
// Body: { target_id: string }
// Logic: Insert into follows table
```

#### `POST /api/bot/transfer/route.ts`
```typescript
// Body: { target_id: string, amount: number }
// Logic: Same as /api/transfer-spits but with bot's user_id
```

---

## TASK 4: Datacenter API Key (ALREADY DONE)

The datacenter API key has already been generated and inserted into Supabase. **No action needed here.**

- The `datacenter_keys` table already has a row with the SHA-256 hash of the key
- The datacenter's `.env.local` has the raw key set as `DATACENTER_API_KEY`
- When validating, SHA-256 hash the incoming `X-Datacenter-Key` header value and compare against `datacenter_keys.key_hash`

---

## EXISTING CODE PATTERNS TO FOLLOW

### Authentication (for user-facing routes like purchase)
```typescript
const supabase = await createServerClient()   // from '@/lib/supabase/server'
const { data: { user } } = await supabase.auth.getUser()
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
```

### Admin client (for bot action routes)
```typescript
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

### Deducting credits (server-side pattern)
```typescript
// Read current balance
const { data: credits } = await supabaseAdmin
  .from('user_credits').select('balance').eq('user_id', userId).single()

const newBalance = credits.balance - amount
await supabaseAdmin.from('user_credits').update({ balance: newBalance }).eq('user_id', userId)
await supabaseAdmin.from('credit_transactions').insert({
  user_id: userId, type: 'bot_purchase', amount: -amount, balance_after: newBalance
})
```

### Deducting gold (server-side pattern)
```typescript
const { data: gold } = await supabaseAdmin
  .from('user_gold').select('balance').eq('user_id', userId).single()

const newBalance = gold.balance - amount
await supabaseAdmin.from('user_gold').update({ balance: newBalance }).eq('user_id', userId)
await supabaseAdmin.from('gold_transactions').insert({
  user_id: userId, type: 'bot_purchase', amount: -amount, balance_after: newBalance
})
```

### Client-side hooks for the datacenter page
```typescript
import { useGold } from '@/hooks/useGold'
import { useCredits } from '@/hooks/useCredits'

// Check balance
const { balance: goldBalance, hasGold, refreshBalance: refreshGold } = useGold()
const { balance: creditBalance, hasCredits, refreshBalance: refreshCredits } = useCredits()
```

---

## FILE STRUCTURE (what to create)

```
src/app/
  (main)/
    datacenter/
      page.tsx                    # Bot marketplace + management page
  api/
    bot/
      purchase/
        route.ts                  # POST - buy a bot (user auth)
      my-bots/
        route.ts                  # GET - list user's bots (user auth)
      [id]/
        config/
          route.ts                # PATCH - update bot config (user auth)
      status/
        route.ts                  # GET - bot game state (datacenter auth)
      feed/
        route.ts                  # GET - recent feed (datacenter auth)
      post/
        route.ts                  # POST - create spit (datacenter auth)
      reply/
        route.ts                  # POST - reply to spit (datacenter auth)
      like/
        route.ts                  # POST - like spit (datacenter auth)
      respit/
        route.ts                  # POST - respit (datacenter auth)
      attack/
        route.ts                  # POST - attack user (datacenter auth)
      use-item/
        route.ts                  # POST - use item (datacenter auth)
      bank/
        deposit/
          route.ts                # POST - bank deposit (datacenter auth)
        withdraw/
          route.ts                # POST - bank withdraw (datacenter auth)
      buy-item/
        route.ts                  # POST - buy shop item (datacenter auth)
      chest/
        route.ts                  # POST - buy+open chest (datacenter auth)
      follow/
        route.ts                  # POST - follow user (datacenter auth)
      transfer/
        route.ts                  # POST - transfer spits (datacenter auth)
```

---

## SUMMARY

| Priority | Task | Auth Type |
|----------|------|-----------|
| 1 | `POST /api/bot/purchase` | User session |
| 2 | `GET /api/bot/my-bots` | User session |
| 3 | `PATCH /api/bot/[id]/config` | User session |
| 4 | Datacenter page UI (`/datacenter`) | User session |
| 5 | Bot action validation helper | Datacenter key |
| 6 | `GET /api/bot/status` | Datacenter key |
| 7 | `GET /api/bot/feed` | Datacenter key |
| 8 | `POST /api/bot/post` | Datacenter key |
| 9 | `POST /api/bot/reply` | Datacenter key |
| 10 | `POST /api/bot/like` | Datacenter key |
| 11 | `POST /api/bot/respit` | Datacenter key |
| 12 | `POST /api/bot/attack` | Datacenter key |
| 13 | All other bot action endpoints | Datacenter key |
| 14 | Generate datacenter API key | One-time setup |
| 15 | Add nav link to datacenter page | UI |

Bot cost: **1000 spits OR 100 gold**. No Stripe involved - purely in-game currency.
