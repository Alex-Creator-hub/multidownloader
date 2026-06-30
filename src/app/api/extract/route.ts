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

function parseMedia(legacy: any, text: string): Media[] | null {
  const rawMedia: any[] = legacy?.extended_entities?.media || [];
  if (!rawMedia.length) return null;

  return rawMedia.map((m: any) => {
    if (m.type === "video" || m.type === "animated_gif") {
      const variants = (m.video_info?.variants || [])
        .filter((v: any) => v.bitrate && v.content_type === "video/mp4")
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
      const bestVariant = variants[0];
      const url = bestVariant?.url || variants[variants.length - 1]?.url || "";
      return {
        type: "video" as const,
        title: text,
        previewUrl: m.media_url_https || "",
        formats: [{ quality: labelForBitrate(bestVariant?.bitrate), url }],
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

// Extract tweet from $_TSR dehydrated relay data
function extractFromTSR(html: string): Media[] | null {
  // Find the $_TSR.router initialization script
  const tsrMatch = html.match(/\$_\w+\.router\s*=\s*\(\$R\s*=>\s*\$R\[\d+\]\s*=\s*(\{[\s\S]*?\})\s*\)\(/);
  if (!tsrMatch) return null;

  try {
    // Extract relayRecords from the dehydrated data
    // The format uses $R[N]={...} assignments with circular refs
    // We need to find all the legacy tweet data objects
    const scriptContent = tsrMatch[0];

    // Find legacy tweet data: "client:<tweetId>:legacy":{__id:"...",__typename:"LegacyTweet",...full_text:"...",...extended_entities:...}
    // The pattern: __typename":"LegacyTweet" followed by the fields
    const legacyPattern = /"LegacyTweet"[\s\S]*?"full_text"\s*:\s*"((?:[^"\\]|\\.)*)"[\s\S]*?"extended_entities"\s*:\s*(\{[^}]*"media"\s*:\s*\[[\s\S]*?\]\s*\})/g;
    const matches = [...scriptContent.matchAll(legacyPattern)];

    if (matches.length === 0) return null;

    const allMedia: Media[] = [];
    for (const m of matches) {
      const fullText = JSON.parse(`"${m[1]}"`);
      const text = fullText.slice(0, 60) || "X 媒体";

      // Parse the extended_entities JSON
      let entitiesStr = m[2];
      // Balance braces for the JSON object
      let depth = 0;
      let end = 0;
      for (let i = 0; i < entitiesStr.length; i++) {
        if (entitiesStr[i] === "{") depth++;
        else if (entitiesStr[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      if (end === 0) continue;
      entitiesStr = entitiesStr.slice(0, end);

      const entities = JSON.parse(entitiesStr);
      const rawMedia: any[] = entities?.media || [];
      if (!rawMedia.length) continue;

      for (const rm of rawMedia) {
        if (rm.type === "video" || rm.type === "animated_gif") {
          const variants = (rm.video_info?.variants || [])
            .filter((v: any) => v.bitrate && v.content_type === "video/mp4")
            .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
          const best = variants[0];
          const url = best?.url || variants[variants.length - 1]?.url || "";
          allMedia.push({
            type: "video" as const,
            title: text,
            previewUrl: rm.media_url_https || "",
            formats: [{ quality: labelForBitrate(best?.bitrate), url }],
          });
        } else {
          allMedia.push({
            type: "image" as const,
            title: text,
            previewUrl: rm.media_url_https || "",
            formats: [{ quality: "原图", url: rm.media_url_https + "?name=orig" }],
          });
        }
      }
    }
    return allMedia.length > 0 ? allMedia : null;
  } catch {
    return null;
  }
}

// Try traditional __NEXT_DATA__ extraction (for older pages)
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
    return parseMedia(legacy, text);
  } catch {
    return null;
  }
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
  const hasNextData = html.includes("__NEXT_DATA__");
  const hasTSR = html.includes("$_TSR") || html.includes("router=($R");

  // Try $_TSR / Relay format (current X.com format)
  const tsrMedia = extractFromTSR(html);
  if (tsrMedia) return { media: tsrMedia, diagnostic: "" };

  // Try __NEXT_DATA__ format (older format)
  const ndMedia = extractFromNextData(html);
  if (ndMedia) return { media: ndMedia, diagnostic: "" };

  return {
    media: null,
    diagnostic: `${url}: HTML ${html.length}B, hasNextData=${hasNextData}, hasTSR=${hasTSR}`,
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
    // Try canonical URL format first (x.com/username/status/id)
    const canonicalUrl = `https://x.com/${username}/status/${tweetId}`;
    const result = await tryScrape(canonicalUrl);
    if (result.media && result.media.length > 0)
      return NextResponse.json({ data: result.media });
    diagnostics.push(result.diagnostic);

    // Fallback: try /i/status paths
    const fallbackUrls = [
      `https://x.com/i/status/${tweetId}`,
      `https://twitter.com/i/status/${tweetId}`,
    ];
    for (const u of fallbackUrls) {
      const r = await tryScrape(u);
      if (r.media && r.media.length > 0)
        return NextResponse.json({ data: r.media });
      diagnostics.push(r.diagnostic);
    }

    return NextResponse.json(
      { error: "该推文中没有检测到视频或图片，推文可能不存在或为私密账号", diagnostics },
      { status: 400 },
    );
  } catch (e: any) {
    return NextResponse.json({ error: `解析失败: ${e.message}` }, { status: 500 });
  }
}
