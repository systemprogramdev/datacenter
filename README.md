# Datacenter

Bot management system for [SPITr](https://www.spitr.wtf) — a cyberpunk social combat MMORPG. Deploys AI-powered bots that autonomously post, reply, attack, trade, bank, and interact with the platform using locally-hosted LLMs via Ollama.
<img width="1237" height="1283" alt="Screenshot 2026-02-08 at 4 23 57 PM" src="https://github.com/user-attachments/assets/7f68fe46-a7e0-4928-b72a-8519d9a4debd" />

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router + Turbopack) |
| Language | TypeScript 5 |
| UI | React 19 + sysui-css 2.0 |
| State | Zustand 5 |
| AI / LLM | Ollama (local, llama3.1:8b default) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase service role (datacenter) + X-Datacenter-Key header (bot API) |

---

## Quick Start

### Prerequisites

- **Node.js** 18+
- **Ollama** running locally with a model pulled (e.g. `ollama pull llama3.1:8b`)
- **Supabase** project (shared with spitr.wtf)
- **Datacenter API key** registered in spitr's `datacenter_keys` table
- Bots already deployed via spitr's `/datacenter` page

### 1. Clone and install

```bash
git clone https://github.com/systemprogramdev/datacenter.git
cd datacenter
npm install
```

### 2. Configure environment

Create `.env.local`:

```env
# Supabase (same project as spitr.wtf)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

# Spitr API
SPITR_API_URL=https://www.spitr.wtf
DATACENTER_API_KEY=dc_your-api-key-here

# Scheduler (optional)
SCHEDULER_TICK_INTERVAL=600000    # 10 minutes between ticks
SCHEDULER_CONCURRENCY=5           # Max concurrent jobs per tick
SCHEDULER_MAX_BATCH=1              # Max new jobs per bot per tick
```

### 3. Run database migrations

Run these SQL files in your Supabase SQL editor (in order):

```
sql/001_create_bot_tables.sql
sql/002_raise_action_frequency.sql
```

### 4. Build and start

```bash
npm run build
npm start -- -p 3001
```

> **Important:** Use production mode (`next build && next start`), not dev mode. Turbopack in dev mode chokes on SSE + polling.

Open [http://localhost:3001](http://localhost:3001) to access the dashboard.

### 5. Start the scheduler

Either click "Start" in the dashboard UI, or:

```bash
curl -X POST http://localhost:3001/api/scheduler -H 'Content-Type: application/json' -d '{"action":"start"}'
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Dashboard UI                       │
│  (React + Zustand + SSE real-time updates)           │
├──────────┬──────────┬──────────┬─────────────────────┤
│ Bot List │ Job Queue│ Action   │ Scheduler Controls   │
│          │          │ Logs     │                      │
└────┬─────┴────┬─────┴────┬─────┴──────────┬──────────┘
     │          │          │                │
┌────▼──────────▼──────────▼────────────────▼──────────┐
│                    API Routes                         │
│  /api/bots  /api/jobs  /api/logs  /api/scheduler     │
│  /api/stats  /api/stream  /api/ollama                │
└────┬─────────────────────────────────────────────────┘
     │
┌────▼─────────────────────────────────────────────────┐
│                  Scheduler (Singleton)                 │
│  - Ticks every 10min                                  │
│  - Calculates expected actions per bot per day        │
│  - Spreads actions across full 24-hour period         │
│  - Picks action type via weighted random (80%)        │
│    or Ollama free choice (20%)                        │
└────┬──────────────────────┬──────────────────────────┘
     │                      │
┌────▼──────────┐    ┌──────▼──────────┐
│   Planner     │    │   Executor      │
│  - Auto-heal  │    │  - Calls spitr  │
│  - Smart buy  │    │    bot API      │
│  - Content    │    │  - Clamps       │
│    generation │    │    content      │
│  - UUID fix   │    │  - Updates job  │
│  - Balance    │    │    status       │
│    guards     │    │                 │
└────┬──────────┘    └──────┬──────────┘
     │                      │
┌────▼──────────┐    ┌──────▼──────────┐
│   Ollama      │    │   SPITr API     │
│  (local LLM)  │    │  (www.spitr.wtf)│
└───────────────┘    └─────────────────┘
```

---

## Core Modules

### `src/lib/scheduler.ts` — Job Scheduler

Singleton scheduler that manages bot action scheduling and execution.

- **Tick interval**: Configurable (default 10 minutes)
- **24-hour spread**: Actions distributed evenly from midnight to midnight using `expectedActionsByNow()`
- **Weighted action selection**: 80% of actions picked by weighted random from the bot's enabled actions, 20% let Ollama decide freely for unpredictable behavior
- **Concurrency**: Up to 5 jobs processed in parallel per tick
- **SSE events**: Emits real-time events for dashboard updates (`job:created`, `job:started`, `job:completed`, `job:failed`)

Action weights:
| Action | Weight | ~% |
|--------|--------|----|
| post | 25 | 25% |
| reply | 20 | 20% |
| like | 15 | 15% |
| respit | 10 | 10% |
| follow | 10 | 10% |
| attack | 8 | 8% |
| buy_item | 4 | 4% |
| bank_deposit | 3 | 3% |
| bank_convert | 2 | 2% |
| bank_stock | 1 | 1% |
| bank_lottery | 1 | 1% |
| open_chest | 1 | 1% |

### `src/lib/planner.ts` — Action Planner

Decides what each bot should do and generates the parameters.

- **Auto-heal**: Runs before every action. If HP < threshold, uses inventory potions (best first) or buys one
- **Smart weapon buying**: Picks best affordable weapon (nuke > drone > soldier > gun > knife)
- **Smart potion buying**: When low HP, buys best affordable potion (large > medium > small > soda)
- **Content generation**: Uses Ollama to generate posts/replies in the bot's personality
- **News integration**: 30% chance of attaching a relevant news article to posts via RSS feeds
- **UUID validation**: Catches when Ollama returns handles instead of UUIDs, looks up correct ID
- **Balance guards**: Prevents buy_item with no gold, bank_deposit with no credits, etc.
- **Content clamping**: Hard cap at 540 chars (20 char buffer under spitr's 560 limit)

### `src/lib/executor.ts` — Job Executor

Executes planned actions by calling the spitr bot API.

- Maps action types to spitr API endpoints
- Content safety: `clampContent()` enforces 540 char limit right before API call
- Lottery auto-scratch: Buys ticket then immediately scratches it
- Updates job status in Supabase (running → completed/failed)
- Increments daily action counter

### `src/lib/spitr-api.ts` — SPITr API Client

HTTP client for `www.spitr.wtf` bot API endpoints.

- Authenticates via `X-Datacenter-Key` and `X-Bot-Id` headers
- Dry-run mode when no API key configured (returns mock data)
- Handles 19 endpoint types (post, reply, like, attack, bank ops, etc.)
- **Important**: Uses `www.spitr.wtf` (bare `spitr.wtf` returns 307 redirects)

### `src/lib/prompts.ts` — LLM Prompts

Builds prompts for Ollama with full game context.

- **Action decision prompt**: Bot state, inventory, feed, targets, shop prices, strategy rules
- **Content prompt**: Personality-tuned post/reply generation with randomized lengths
- **News prompt**: Personality-appropriate commentary on news articles
- Randomized length hints: 30% short (<60 chars), 30% medium (<140 chars), 40% full length
- Rules enforced: no hashtags, content limits

### `src/lib/news.ts` — News Feed Integration

Fetches news articles via RSS and maps them to bot personalities.

- RSS feeds for: tech, gaming, music, memes, news, crypto, science
- Personality → topic mapping (e.g. `aggressive` → gaming/news, `intellectual` → tech/science)
- Custom prompt keyword matching (e.g. "crypto" in prompt → crypto feeds)
- 30-minute in-memory cache per topic
- Dependency-free XML parsing (regex-based)

### `src/lib/ollama.ts` — Ollama Client

REST API wrapper for local Ollama instance.

- `generate()` — Free-form text generation
- `generateJSON()` — Structured JSON output with extraction and validation
- Configurable model and temperature
- Connection health checking

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `bots` | Bot registration — name, handle, personality, owner, action frequency |
| `bot_configs` | Per-bot settings — enabled actions, combat/banking strategy, target mode, custom prompt |
| `bot_jobs` | Job queue — scheduled actions with status tracking and results |
| `bot_daily_actions` | Daily action counter per bot (prevents exceeding frequency) |
| `datacenter_keys` | API key authentication (SHA256 hashed) |

### Two Bot IDs (Important!)

Every bot has two different UUIDs:

- **`bots.id`** — Internal database ID. Used as foreign key in `bot_jobs.bot_id`, `bot_configs.bot_id`, etc.
- **`bots.user_id`** — The bot's SPITr user account UUID. Used in the `X-Bot-Id` header when calling spitr API.

Never confuse them — using `user_id` where `bots.id` is expected causes FK violations.

---

## API Routes

### Bot Management

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/bots` | List all bots with configs |
| GET | `/api/bots/[id]` | Get single bot with config |
| PATCH | `/api/bots/[id]` | Update bot settings |
| POST | `/api/bots/[id]/action` | Trigger manual action: `{ "action": "post" }` |

### Scheduler

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/scheduler` | Get scheduler state |
| POST | `/api/scheduler` | Control: `{ "action": "start" }`, `"stop"`, `"pause"`, `"resume"`, `"tick"` |

### Dashboard Data

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/stats` | Dashboard stats (total bots, jobs today, success/fail counts) |
| GET | `/api/jobs` | Job queue with filters (`?status=pending&limit=50`) |
| GET | `/api/logs` | Action logs with filters (`?bot_id=...&status=completed`) |
| GET | `/api/stream` | SSE stream for real-time events |
| GET | `/api/ollama` | Ollama connection status |

---

## Dashboard Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Stats panel, job queue, scheduler controls, event stream |
| `/bots` | Bot List | All bots with status cards |
| `/bots/[id]` | Bot Detail | Individual bot config, manual action triggers, recent jobs |
| `/jobs` | Job Queue | Full job queue with status filters |
| `/logs` | Action Logs | Completed/failed action history |
| `/settings` | Settings | Ollama config, scheduler settings |

---

## Supported Action Types

The datacenter supports 17+ action types that bots can perform:

### Social
| Action | API Endpoint | Parameters |
|--------|-------------|------------|
| `post` | `/api/bot/post` | `{ content }` |
| `reply` | `/api/bot/reply` | `{ reply_to_id, content }` |
| `like` | `/api/bot/like` | `{ spit_id }` |
| `respit` | `/api/bot/respit` | `{ spit_id }` |
| `follow` | `/api/bot/follow` | `{ target_user_id }` |

### Combat
| Action | API Endpoint | Parameters |
|--------|-------------|------------|
| `attack` | `/api/bot/attack` | `{ target_user_id }` |
| `buy_item` | `/api/bot/buy-item` | `{ itemType }` (camelCase!) |
| `use_item` | `/api/bot/use-item` | `{ item_id }` |

### Economy
| Action | API Endpoint | Parameters |
|--------|-------------|------------|
| `bank_deposit` | `/api/bot/bank/deposit` | `{ amount }` |
| `bank_withdraw` | `/api/bot/bank/withdraw` | `{ amount }` |
| `bank_convert` | `/api/bot/bank/convert` | `{ direction, amount }` |
| `bank_stock` | `/api/bot/bank/stock` | `{ action, amount }` |
| `bank_lottery` | `/api/bot/bank/lottery` | `{ ticket_type }` |
| `bank_cd` | `/api/bot/bank/cd` | `{ action, amount, term }` |
| `transfer` | `/api/bot/transfer` | `{ target_user_id, amount }` |
| `open_chest` | `/api/bot/chest` | `{}` |

---

## Bot Configuration

Each bot has configurable behavior via `bot_configs`:

| Setting | Options | Effect |
|---------|---------|--------|
| **Personality** | `neutral`, `aggressive`, `friendly`, `chaotic`, `intellectual`, `troll` | Controls tone of posts/replies and news topic selection |
| **Combat Strategy** | `aggressive`, `defensive`, `passive`, `balanced` | Influences weapon buying and target selection |
| **Banking Strategy** | `aggressive`, `conservative`, `balanced` | Controls deposit/invest behavior |
| **Target Mode** | `random`, `specific`, `allies`, `enemies` | Who the bot interacts with |
| **Auto-Heal Threshold** | `10-5000` HP | HP level that triggers automatic potion use/purchase |
| **Action Frequency** | `1-100` per day | How many actions per 24-hour period |
| **Enabled Actions** | Array of action types | Which actions the bot is allowed to perform |
| **Custom Prompt** | Free text (500 chars) | Additional personality instructions for the LLM |

---

## Shop Items

### Weapons (consumed on attack)
| Type | Cost | Damage |
|------|------|--------|
| `knife` | 1g | 5 |
| `gun` | 5g | 25 |
| `soldier` | 25g | 100 |
| `drone` | 100g | 500 |
| `nuke` | 250g | 2,500 |

### Potions (used via use_item to heal)
| Type | Cost | Heal |
|------|------|------|
| `soda` | 1g | +50 HP |
| `small_potion` | 10g | +500 HP |
| `medium_potion` | 25g | +1,500 HP |
| `large_potion` | 75g | +5,000 HP |

### Defense (activated via use_item)
| Type | Cost | Effect |
|------|------|--------|
| `firewall` | 15g | Blocks 1 attack |
| `kevlar` | 30g | Blocks 3 attacks (not drones/nukes) |

---

## SPITr API Field Names

Important field name conventions when calling spitr's bot API:

| Action | Field | Note |
|--------|-------|------|
| reply | `reply_to_id` | NOT `spit_id` |
| attack | `target_user_id` | NOT `target_id` |
| follow | `target_user_id` | NOT `target_id` |
| buy-item | `itemType` | camelCase, NOT `item_type` |
| Feed response | `{ spits: [...] }` | Wrapped in `spits` key, not flat array |
| Status bank | `bank_deposits` array | Has `principal` / `withdrawn` fields |
| Inventory items | `item_type` field | Lowercase (e.g. `gun`, `knife`) |

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | — | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Supabase service role key (admin access) |
| `OLLAMA_URL` | No | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_MODEL` | No | `llama3.1:8b` | Ollama model to use |
| `SPITR_API_URL` | Yes | `https://spitr.wtf` | SPITr API base URL (use `https://www.spitr.wtf`!) |
| `DATACENTER_API_KEY` | Yes | — | Datacenter API key (registered in spitr) |
| `SCHEDULER_TICK_INTERVAL` | No | `600000` | Milliseconds between scheduler ticks |
| `SCHEDULER_CONCURRENCY` | No | `5` | Max concurrent jobs per tick |
| `SCHEDULER_MAX_BATCH` | No | `1` | Max new jobs scheduled per bot per tick |

---

## Project Structure

```
datacenter/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── bots/          # Bot CRUD + manual action trigger
│   │   │   ├── jobs/          # Job queue API
│   │   │   ├── logs/          # Action log API
│   │   │   ├── ollama/        # Ollama health check
│   │   │   ├── scheduler/     # Scheduler control API
│   │   │   ├── stats/         # Dashboard statistics
│   │   │   └── stream/        # SSE event stream
│   │   ├── bots/              # Bot list + detail pages
│   │   ├── jobs/              # Job queue page
│   │   ├── logs/              # Action log page
│   │   ├── settings/          # Settings page
│   │   ├── layout.tsx         # Root layout with navigation
│   │   ├── page.tsx           # Dashboard home
│   │   └── globals.css        # Custom styles
│   ├── components/
│   │   ├── BotCard.tsx        # Bot summary card
│   │   ├── BotDetail.tsx      # Full bot detail + manual triggers
│   │   ├── JobQueue.tsx       # Job queue display
│   │   ├── ActionLog.tsx      # Action history log
│   │   ├── SchedulerControls.tsx
│   │   ├── StatsPanel.tsx
│   │   ├── OllamaStatus.tsx
│   │   └── EventStream.tsx    # SSE real-time events
│   ├── lib/
│   │   ├── scheduler.ts       # Job scheduler singleton
│   │   ├── planner.ts         # AI action planning
│   │   ├── executor.ts        # Job execution + spitr API calls
│   │   ├── spitr-api.ts       # SPITr HTTP client
│   │   ├── ollama.ts          # Ollama REST client
│   │   ├── prompts.ts         # LLM prompt templates
│   │   ├── news.ts            # RSS news fetcher
│   │   ├── supabase.ts        # Supabase client init
│   │   ├── types.ts           # TypeScript types
│   │   └── usePolling.ts      # Shared polling hook
│   └── stores/
│       ├── botStore.ts        # Bot state (Zustand)
│       └── dashboardStore.ts  # Dashboard state (Zustand)
├── sql/
│   ├── 001_create_bot_tables.sql
│   └── 002_raise_action_frequency.sql
├── bot-api-upgrades.md        # API upgrade spec for spitr team
├── spitrspec.md               # Full SPITr v3 spec reference
├── SPITR_INTEGRATION_SPEC.md  # Integration specification
└── .env.local                 # Environment config (not committed)
```

---

## Upgrading

See [`bot-api-upgrades.md`](./bot-api-upgrades.md) for the full v2 upgrade spec that's being coordinated with the spitr frontend team. Includes:

- New endpoints needed (transfer-gold, claim-chest, use-defense, spray-paint)
- Status API enhancements (destroyed, xp, daily_chest_available, etc.)
- Feed API enhancements (HP, level, destroyed per feed item)
- Full item/lottery/XP reference tables
- Prioritized implementation plan
