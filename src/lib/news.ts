import type { BotWithConfig } from "./types";

export interface NewsArticle {
  title: string;
  link: string;
  source: string;
}

// RSS feeds organized by topic
const FEEDS: Record<string, string[]> = {
  tech: [
    "https://hnrss.org/frontpage?count=10",
    "https://feeds.arstechnica.com/arstechnica/index",
    "https://www.theverge.com/rss/index.xml",
  ],
  gaming: [
    "https://kotaku.com/rss",
    "https://www.gamespot.com/feeds/mashup/",
    "https://www.pcgamer.com/rss/",
  ],
  music: [
    "https://pitchfork.com/feed/feed-news/rss",
    "https://www.rollingstone.com/feed/",
    "https://consequenceofsound.net/feed/",
  ],
  memes: [
    "https://www.reddit.com/r/nottheonion/.rss?limit=10",
    "https://www.reddit.com/r/worldnews/.rss?limit=10",
    "https://www.reddit.com/r/technology/.rss?limit=10",
  ],
  news: [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    "https://feeds.reuters.com/reuters/topNews",
  ],
  crypto: [
    "https://cointelegraph.com/rss",
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
  ],
  science: [
    "https://www.reddit.com/r/science/.rss?limit=10",
    "https://phys.org/rss-feed/",
  ],
};

// Map bot personality + custom_prompt keywords to relevant feed topics
function getTopicsForBot(bot: BotWithConfig): string[] {
  const personality = bot.personality.toLowerCase();
  const prompt = (bot.config?.custom_prompt || "").toLowerCase();
  const combined = `${personality} ${prompt}`;

  const topics: string[] = [];

  // Check for keyword matches in personality + custom prompt
  if (/metal|music|band|rock|punk|rap|hip.?hop|song|concert/.test(combined)) topics.push("music");
  if (/game|gaming|gamer|esport|steam|playstation|xbox|nintendo/.test(combined)) topics.push("gaming");
  if (/tech|code|program|hack|computer|ai|software|dev/.test(combined)) topics.push("tech");
  if (/crypto|bitcoin|eth|blockchain|web3|nft|defi/.test(combined)) topics.push("crypto");
  if (/science|space|physics|biology|research|nasa/.test(combined)) topics.push("science");
  if (/troll|meme|chaos|random|funny|shitpost|edgy/.test(combined)) topics.push("memes");
  if (/news|politic|world|current.?event/.test(combined)) topics.push("news");

  // Personality-based defaults if no keyword matches
  if (topics.length === 0) {
    switch (personality) {
      case "aggressive":
      case "troll":
        topics.push("memes", "news");
        break;
      case "chaotic":
        topics.push("memes", "music");
        break;
      case "intellectual":
        topics.push("tech", "science");
        break;
      case "friendly":
        topics.push("news", "tech");
        break;
      default:
        topics.push("tech", "news");
    }
  }

  return topics;
}

// Simple XML tag extraction (no dependency needed)
function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}`));
  return match ? match[1].trim() : "";
}

// Parse RSS XML into articles
function parseRSS(xml: string, source: string): NewsArticle[] {
  const articles: NewsArticle[] = [];

  // Match <item> or <entry> blocks
  const itemRegex = new RegExp("<(?:item|entry)[\\s>]([\\s\\S]*?)</(?:item|entry)>", "g");
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");

    // Try <link> tag content, then href attribute (Atom feeds)
    let link = extractTag(block, "link");
    if (!link) {
      const hrefMatch = block.match(/<link[^>]*href="([^"]+)"/);
      if (hrefMatch) link = hrefMatch[1];
    }

    if (title && link) {
      articles.push({ title: decodeEntities(title), link, source });
    }
  }

  return articles;
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

// In-memory cache: topic -> { articles, fetchedAt }
const cache = new Map<string, { articles: NewsArticle[]; fetchedAt: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function fetchFeed(url: string): Promise<NewsArticle[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Datacenter-Bot/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const source = new URL(url).hostname.replace("www.", "");
    return parseRSS(xml, source);
  } catch {
    return [];
  }
}

async function getArticlesForTopic(topic: string): Promise<NewsArticle[]> {
  const cached = cache.get(topic);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.articles;
  }

  const feeds = FEEDS[topic] || FEEDS.news;
  // Pick a random feed from the topic to avoid hammering all of them
  const feed = feeds[Math.floor(Math.random() * feeds.length)];
  const articles = await fetchFeed(feed);

  if (articles.length > 0) {
    cache.set(topic, { articles, fetchedAt: Date.now() });
  }

  return articles;
}

/** Get a relevant news article for a bot based on its personality */
export async function getNewsForBot(bot: BotWithConfig): Promise<NewsArticle | null> {
  const topics = getTopicsForBot(bot);
  const topic = topics[Math.floor(Math.random() * topics.length)];

  const articles = await getArticlesForTopic(topic);
  if (articles.length === 0) return null;

  // Pick a random article
  return articles[Math.floor(Math.random() * articles.length)];
}
