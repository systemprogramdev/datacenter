import { supabase } from "./supabase";
import type { BotWithConfig } from "./types";

export interface TrendingItem {
  id: string;
  source: string;
  category: string;
  title: string;
  url: string;
  description: string | null;
  thumbnail_url: string | null;
  score: number;
  metadata: Record<string, unknown> | null;
}

// --- Source Ingestors ---

interface RawTrend {
  source: string;
  category: string;
  title: string;
  url: string;
  description?: string;
  thumbnail_url?: string;
  score: number;
  metadata?: Record<string, unknown>;
}

const FETCH_TIMEOUT = 15000;

async function safeFetch(url: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: { "User-Agent": "Datacenter-Bot/2.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
  } catch {
    return null;
  }
}

// Reddit JSON API (no auth needed for public subreddits)
const REDDIT_SUBS: Record<string, string[]> = {
  tech: ["technology", "programming", "artificial", "MachineLearning", "gadgets", "Android", "apple"],
  gaming: ["gaming", "Games", "pcgaming", "PS5", "NintendoSwitch", "gamernews", "Steam"],
  music: ["Music", "hiphopheads", "indieheads", "popheads", "listentothis", "trap"],
  crypto: ["CryptoCurrency", "bitcoin", "ethereum", "defi", "altcoin"],
  science: ["science", "space", "Futurology", "EverythingScience", "Physics"],
  memes: ["nottheonion", "interestingasfuck", "todayilearned", "OutOfTheLoop", "meirl"],
  news: ["worldnews", "news", "UpliftingNews", "geopolitics", "economics"],
  culture: ["movies", "television", "books", "anime", "Marvel", "StarWars", "Documentaries"],
};

async function ingestReddit(category: string, subreddit: string): Promise<RawTrend[]> {
  const res = await safeFetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=10`);
  if (!res || !res.ok) return [];

  try {
    const json = await res.json();
    const posts = json?.data?.children || [];
    return posts
      .filter((p: { data: { stickied: boolean; is_self: boolean } }) =>
        !p.data.stickied && !p.data.is_self
      )
      .slice(0, 8)
      .map((p: { data: { title: string; url: string; selftext: string; score: number; num_comments: number; subreddit: string; permalink: string; thumbnail: string } }) => ({
        source: "reddit",
        category,
        title: p.data.title,
        url: p.data.url.startsWith("http") ? p.data.url : `https://reddit.com${p.data.permalink}`,
        description: p.data.selftext?.slice(0, 200) || undefined,
        thumbnail_url: p.data.thumbnail?.startsWith("http") ? p.data.thumbnail : undefined,
        score: Math.log10(Math.max(p.data.score, 1)) / 5, // normalize to ~0-1
        metadata: { upvotes: p.data.score, comments: p.data.num_comments, subreddit: p.data.subreddit },
      }));
  } catch {
    return [];
  }
}

// Hacker News API (free, structured JSON)
async function ingestHackerNews(): Promise<RawTrend[]> {
  const res = await safeFetch("https://hacker-news.firebaseio.com/v0/topstories.json");
  if (!res || !res.ok) return [];

  try {
    const ids: number[] = await res.json();
    const top = ids.slice(0, 15);

    const stories: RawTrend[] = [];
    // Fetch in batches of 5
    for (let i = 0; i < top.length; i += 5) {
      const batch = top.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(async (id) => {
          const r = await safeFetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          if (!r || !r.ok) return null;
          return r.json();
        })
      );
      for (const story of results) {
        if (!story || !story.url || !story.title) continue;
        stories.push({
          source: "hackernews",
          category: "tech",
          title: story.title,
          url: story.url,
          description: undefined,
          score: Math.log10(Math.max(story.score || 1, 1)) / 3,
          metadata: { hn_id: story.id, points: story.score, comments: story.descendants },
        });
      }
    }
    return stories;
  } catch {
    return [];
  }
}

// YouTube trending via RSS (no API key needed)
const YT = (id: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
const YOUTUBE_CHANNELS: Record<string, string[]> = {
  tech: [
    YT("UCBJycsmduvYEL83R_U4JriQ"), // MKBHD
    YT("UCXuqSBlHAE6Xw-yeJA0Tunw"), // Linus Tech Tips
    YT("UCey_c7U86mJGz1VJWH5CYPA"), // Fireship
    YT("UCsBjURrPoezykLs9EqgamOA"), // Fireship (alt)
    YT("UCVHFbqXqoYvEWM1Ddxl0QDg"), // Android Authority
    YT("UC0vBXGSyV14uvJ4hECDOl0Q"), // Tech Linked
  ],
  gaming: [
    YT("UCam8T03EOFBsNdR0thrFHdQ"), // videogamedunkey
    YT("UCNvzD7Z-g64bPXxGzaQaa4g"), // penguinz0/Cr1TiKaL
    YT("UCWX2lBtEbDaOsfgnqJNDnog"), // TheRadBrad
    YT("UCWqr2tH3dPshNhPjV5h1xRw"), // jacksepticeye
    YT("UC-lHJZR3Gqxm24_Vd_AJ5Yw"), // PewDiePie
  ],
  science: [
    YT("UCsXVk37bltHxD1rDPwtNM8Q"), // Kurzgesagt
    YT("UCUHW94eEFW7hkUMVaZz4eDg"), // Veritasium
    YT("UC6nSFpj9HTCZ5t-N3Rm3-HA"), // Vsauce
    YT("UCZYTClx2T1of7BRZ86-8fow"), // SciShow
    YT("UCHnyfMqiRRG1u-2MsSQLbXA"), // 3Blue1Brown
  ],
  music: [
    YT("UC-9-kyTW8ZkZNDHQJ6FgpwQ"), // Music (YouTube)
    YT("UCF8e4K03CsEMtP3O4MNq-dQ"), // Genius
    YT("UCcgqSM4YEo5vVQpqwN-MaNg"), // Fantano / theneedledrop
    YT("UCWGkXhrR2JhgiQMbwJiUkKg"), // Complex Music
  ],
  culture: [
    YT("UCHDxYLv8iovIbhrfl16ahyQ"), // Philip DeFranco
    YT("UCX6b17PVsYBQ0ip5gyeme-Q"), // CrashCourse
    YT("UCLXo7UDZvByw2ixzpQCufnA"), // Vox
    YT("UCsT0YIqwnpJCM-mx7-gSA4Q"), // TEDx Talks
  ],
  news: [
    YT("UCupvZG-5ko_eiXAupbDfxWw"), // CNN
    YT("UCeY0bbntWzzVIaj2z3QigXg"), // NBC News
    YT("UC16niRr50-MSBwiO3YDb3RA"), // BBC News
  ],
  crypto: [
    YT("UCqK_GSMbpiV8spgD3ZGloSw"), // Coin Bureau
    YT("UCRvqjQPSeaWn-uEx-w0XOIg"), // Crypto Banter
  ],
  memes: [
    YT("UCpnkp_D4FLPCiXOmDhoAeYA"), // Daily Dose Of Internet
    YT("UCPDXXXJj9nax0fr0Wfc048g"), // Collab DRM
  ],
};

function extractXmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}`));
  return match ? match[1].trim() : "";
}

async function ingestYouTube(category: string, feedUrl: string): Promise<RawTrend[]> {
  const res = await safeFetch(feedUrl);
  if (!res || !res.ok) return [];

  try {
    const xml = await res.text();
    const entries: RawTrend[] = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    let count = 0;

    while ((match = entryRegex.exec(xml)) !== null && count < 5) {
      const block = match[1];
      const title = extractXmlTag(block, "title");
      const videoId = extractXmlTag(block, "yt:videoId");
      if (!title || !videoId) continue;

      entries.push({
        source: "youtube",
        category,
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        score: 0.7, // YouTube doesn't expose view counts in RSS
        metadata: { video_id: videoId },
      });
      count++;
    }
    return entries;
  } catch {
    return [];
  }
}

// Google Trends daily RSS (multiple geo feeds for better coverage)
async function ingestGoogleTrends(): Promise<RawTrend[]> {
  // Try multiple endpoints — Google changes these frequently
  const urls = [
    "https://trends.google.com/trending/rss?geo=US",
    "https://trends.google.com/trends/trendingsearches/daily/rss?geo=US",
  ];
  let res: Response | null = null;
  for (const url of urls) {
    res = await safeFetch(url);
    if (res?.ok) break;
  }
  if (!res || !res.ok) return [];

  try {
    const xml = await res.text();
    const items: RawTrend[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let count = 0;

    while ((match = itemRegex.exec(xml)) !== null && count < 10) {
      const block = match[1];
      const title = extractXmlTag(block, "title");
      const link = extractXmlTag(block, "link");
      const traffic = extractXmlTag(block, "ht:approx_traffic");
      if (!title) continue;

      items.push({
        source: "google_trends",
        category: "culture", // general trending
        title,
        url: link || `https://trends.google.com/trends/explore?q=${encodeURIComponent(title)}`,
        description: traffic ? `~${traffic} searches` : undefined,
        score: 0.8,
        metadata: { traffic },
      });
      count++;
    }
    return items;
  } catch {
    return [];
  }
}

// Existing RSS feeds (kept from news.ts)
const RSS_FEEDS: Record<string, string[]> = {
  tech: [
    "https://hnrss.org/frontpage?count=10",
    "https://feeds.arstechnica.com/arstechnica/index",
    "https://www.theverge.com/rss/index.xml",
  ],
  gaming: [
    "https://kotaku.com/rss",
    "https://www.pcgamer.com/rss/",
  ],
  music: [
    "https://pitchfork.com/feed/feed-news/rss",
    "https://consequenceofsound.net/feed/",
  ],
  news: [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
  ],
  crypto: [
    "https://cointelegraph.com/rss",
  ],
  science: [
    "https://phys.org/rss-feed/",
  ],
};

async function ingestRSS(category: string, feedUrl: string): Promise<RawTrend[]> {
  const res = await safeFetch(feedUrl);
  if (!res || !res.ok) return [];

  try {
    const xml = await res.text();
    const items: RawTrend[] = [];
    const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/g;
    let match;
    let count = 0;

    while ((match = itemRegex.exec(xml)) !== null && count < 8) {
      const block = match[1];
      const title = extractXmlTag(block, "title");
      let link = extractXmlTag(block, "link");
      if (!link) {
        const hrefMatch = block.match(/<link[^>]*href="([^"]+)"/);
        if (hrefMatch) link = hrefMatch[1];
      }
      if (!title || !link) continue;

      items.push({
        source: "rss",
        category,
        title: decodeEntities(title),
        url: link,
        score: 0.5,
        metadata: { feed: new URL(feedUrl).hostname },
      });
      count++;
    }
    return items;
  } catch {
    return [];
  }
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// --- Main Ingestion ---

/** Ingest trending content from all sources. Call every few hours. */
export async function ingestAll(): Promise<{ ingested: number; errors: number }> {
  console.log("[trends] Starting full ingestion...");
  const allTrends: RawTrend[] = [];
  let errors = 0;

  // Hacker News
  try {
    allTrends.push(...(await ingestHackerNews()));
  } catch { errors++; }

  // Google Trends
  try {
    allTrends.push(...(await ingestGoogleTrends()));
  } catch { errors++; }

  // Reddit — pick 2 subs per category for better coverage
  for (const [category, subs] of Object.entries(REDDIT_SUBS)) {
    const shuffled = [...subs].sort(() => Math.random() - 0.5);
    for (const sub of shuffled.slice(0, 2)) {
      try {
        allTrends.push(...(await ingestReddit(category, sub)));
      } catch { errors++; }
    }
  }

  // YouTube — pick 2 channels per category
  for (const [category, feeds] of Object.entries(YOUTUBE_CHANNELS)) {
    const shuffled = [...feeds].sort(() => Math.random() - 0.5);
    for (const feed of shuffled.slice(0, 2)) {
      try {
        allTrends.push(...(await ingestYouTube(category, feed)));
      } catch { errors++; }
    }
  }

  // RSS — pick one feed per category
  for (const [category, feeds] of Object.entries(RSS_FEEDS)) {
    try {
      const feed = feeds[Math.floor(Math.random() * feeds.length)];
      allTrends.push(...(await ingestRSS(category, feed)));
    } catch { errors++; }
  }

  // Upsert into DB (skip duplicates by url)
  let ingested = 0;
  for (const trend of allTrends) {
    const { error } = await supabase.from("trending_content").upsert(
      {
        source: trend.source,
        category: trend.category,
        title: trend.title,
        url: trend.url,
        description: trend.description || null,
        thumbnail_url: trend.thumbnail_url || null,
        score: trend.score,
        metadata: trend.metadata || null,
        ingested_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: "url", ignoreDuplicates: true }
    );
    if (!error) ingested++;
  }

  // Cleanup expired
  await supabase.from("trending_content").delete().lt("expires_at", new Date().toISOString());

  console.log(`[trends] Ingested ${ingested} items (${errors} source errors)`);
  return { ingested, errors };
}

// --- Bot-facing API ---

// Map bot personality to preferred categories (same logic as old news.ts but expanded)
function getCategoriesForBot(bot: BotWithConfig): string[] {
  const personality = bot.personality.toLowerCase();
  const prompt = (bot.config?.custom_prompt || "").toLowerCase();
  const combined = `${personality} ${prompt}`;

  const cats: string[] = [];

  if (/metal|music|band|rock|punk|rap|hip.?hop|song|concert/.test(combined)) cats.push("music");
  if (/game|gaming|gamer|esport|steam|playstation|xbox|nintendo/.test(combined)) cats.push("gaming");
  if (/tech|code|program|hack|computer|ai|software|dev/.test(combined)) cats.push("tech");
  if (/crypto|bitcoin|eth|blockchain|web3|nft|defi/.test(combined)) cats.push("crypto");
  if (/science|space|physics|biology|research|nasa/.test(combined)) cats.push("science");
  if (/troll|meme|chaos|random|funny|shitpost|edgy/.test(combined)) cats.push("memes");
  if (/news|politic|world|current.?event/.test(combined)) cats.push("news");
  if (/movie|film|tv|show|anime|book/.test(combined)) cats.push("culture");

  if (cats.length === 0) {
    switch (personality) {
      case "aggressive":
      case "troll":
        cats.push("memes", "news", "culture");
        break;
      case "chaotic":
        cats.push("memes", "music", "culture");
        break;
      case "intellectual":
        cats.push("tech", "science", "news");
        break;
      case "friendly":
        cats.push("news", "tech", "culture");
        break;
      default:
        cats.push("tech", "news", "culture");
    }
  }

  return cats;
}

// Track recently served URLs per bot to avoid repetition (in-memory, resets on restart)
const recentlyServed = new Map<string, Set<string>>();

/** Get trending content for a bot, matched to personality */
export async function getTrendingForBot(
  bot: BotWithConfig,
  count = 1
): Promise<TrendingItem[]> {
  const categories = getCategoriesForBot(bot);

  const { data, error } = await supabase
    .from("trending_content")
    .select("*")
    .in("category", categories)
    .gt("expires_at", new Date().toISOString())
    .order("score", { ascending: false })
    .limit(30);

  if (error || !data || data.length === 0) return [];

  // Filter out recently served to this bot
  const served = recentlyServed.get(bot.id) || new Set();
  const fresh = data.filter((t: TrendingItem) => !served.has(t.url));
  if (fresh.length === 0) {
    // Reset if all served
    recentlyServed.delete(bot.id);
    return data.slice(0, count) as TrendingItem[];
  }

  // Pick random from top results for variety
  const picked: TrendingItem[] = [];
  const pool = [...fresh];
  for (let i = 0; i < count && pool.length > 0; i++) {
    // Weighted random: favor higher scores but add randomness
    const idx = Math.floor(Math.random() * Math.min(pool.length, 10));
    picked.push(pool[idx] as TrendingItem);
    served.add(pool[idx].url);
    pool.splice(idx, 1);
  }

  recentlyServed.set(bot.id, served);

  // Cleanup served sets that get too large
  if (served.size > 100) recentlyServed.delete(bot.id);

  return picked;
}

/** Build a shareable description for prompt injection */
export function describeTrendingItem(item: TrendingItem): string {
  const sourceLabel =
    item.source === "youtube" ? "YouTube video" :
    item.source === "reddit" ? `Reddit (r/${(item.metadata as Record<string, unknown>)?.subreddit || "popular"})` :
    item.source === "hackernews" ? "Hacker News" :
    item.source === "google_trends" ? "trending on Google" :
    item.source;

  return `"${item.title}" (${sourceLabel}) — ${item.url}`;
}
