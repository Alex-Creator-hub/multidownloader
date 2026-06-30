import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

interface Format { quality: string; url: string }
interface Media { type: "video" | "image"; title: string; previewUrl: string; formats: Format[] }

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

function labelForBitrate(bps: number | undefined): string {
  if (!bps) return "原画";
  if (bps >= 2_000_000) return "高清 1080p";
  if (bps >= 1_000_000) return "高清 720p";
  if (bps >= 500_000) return "标清 480p";
  return "流畅 360p";
}

function buildMedia(legacy: any, text: string): Media[] {
  const rawMedia: any[] = legacy?.extended_entities?.media || [];
  return rawMedia.map((m: any) => {
    if (m.type === "video" || m.type === "animated_gif") {
      const variants = (m.video_info?.variants || [])
        .filter((v: any) => v.bitrate && v.content_type === "video/mp4")
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
      return {
        type: "video" as const,
        title: text,
        previewUrl: m.media_url_https || "",
        formats: variants.map((v: any) => ({
          quality: labelForBitrate(v.bitrate),
          url: v.url,
        })),
      };
    }
    return {
      type: "image" as const,
      title: text,
      previewUrl: m.media_url_https || "",
      formats: [{ quality: "原图", url: m.media_url_https + "?name=orig" }],
    };
  });
}

// Extract a balanced JSON object starting from a known position in a string
function extractBalancedJson(str: string, startPos: number): string | null {
  if (str[startPos] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startPos; i < str.length; i++) {
    const ch = str[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"' && !escaped) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return str.slice(startPos, i + 1);
    }
  }
  return null;
}

// Find all LegacyTweet objects in the dehydrated Relay data
function findLegacyTweetObjects(html: string): any[] {
  const results: any[] = [];
  // Look for the LegacyTweet typename marker
  let searchPos = 0;
  while (true) {
    const idx = html.indexOf('__typename":"LegacyTweet"', searchPos);
    if (idx === -1) break;
    // Find the opening brace before this marker
    const before = html.lastIndexOf("{", idx - 50);
    if (before === -1) { searchPos = idx + 1; continue; }
    searchPos = idx + 1;
    const jsonStr = extractBalancedJson(html, before);
    if (!jsonStr) continue;
    try {
      const obj = JSON.parse(jsonStr);
      if (obj.extended_entities) results.push(obj);
    } catch { /* skip malformed */ }
  }
  return results;
}

// Extract from __NEXT_DATA__ script tag
function extractFromNextData(html: string): Media[] | null {
  const ndMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!ndMatch) return null;
  try {
    const data = JSON.parse(ndMatch[1]);
    let tweet: any = null;
    const tr = data?.props?.pageProps?.tweetResult;
    if (tr?.__typename === "Tweet") tweet = tr;
    if (!tweet) {
      for (const entry of data?.props?.pageProps?.conversationThread?.instructions?.[0]?.entries || []) {
        const r = entry?.content?.itemContent?.tweet_results?.result;
        if (r?.__typename === "Tweet") { tweet = r; break; }
      }
    }
    if (!tweet) return null;
    const legacy = tweet.legacy || {};
    const text = (legacy.full_text || "").slice(0, 60) || "X 媒体";
    const media = buildMedia(legacy, text);
    return media.length > 0 ? media : null;
  } catch {
    return null;
  }
}

// Extract from the dehydrated Relay record store ($_TSR)
function extractFromTSR(html: string): Media[] | null {
  // First, search for extended_entities anywhere in the HTML
  if (!html.includes("extended_entities")) return null;

  const legacyObjs = findLegacyTweetObjects(html);
  const allMedia: Media[] = [];
  for (const obj of legacyObjs) {
    const text = (obj.full_text || "").slice(0, 60) || "X 媒体";
    allMedia.push(...buildMedia(obj, text));
  }
  return allMedia.length > 0 ? allMedia : null;
}

async function tryScrape(url: string): Promise<{ media: Media[] | null; diagnostic: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

  if (!res.ok) return { media: null, diagnostic: `HTTP ${res.status} from ${url}` };

  const html = await res.text();
  const hasMedia = html.includes("extended_entities");

  let media = extractFromNextData(html);
  if (media) return { media, diagnostic: "" };

  media = extractFromTSR(html);
  if (media) return { media, diagnostic: "" };

  return {
    media: null,
    diagnostic: `${url}: HTML ${html.length}B, hasMedia=${hasMedia}`,
  };
}

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url || typeof url !== "string")
    return NextResponse.json({ error: "请输入链接" }, { status: 400 });

  const m = url.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/i);
  if (!m)
    return NextResponse.json({ error: "无法识别 X/Twitter 链接" }, { status: 400 });

  const [, username, tweetId] = m;

  try {
    const diagnostics: string[] = [];
    const urls = [
      `https://x.com/${username}/status/${tweetId}`,
      `https://x.com/i/status/${tweetId}`,
      `https://twitter.com/i/status/${tweetId}`,
    ];

    for (const u of urls) {
      const result = await tryScrape(u);
      if (result.media && result.media.length > 0)
        return NextResponse.json({ data: result.media });
      diagnostics.push(result.diagnostic);
    }

    return NextResponse.json(
      { error: "该推文中没有检测到视频或图片，推文可能不存在或为私密账号", diagnostics },
      { status: 400 },
    );
  } catch (e: any) {
    return NextResponse.json({ error: `解析失败: ${e.message}` }, { status: 500 });
  }
}
