import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

interface Format { quality: string; url: string }
interface Media { type: "video" | "image"; title: string; previewUrl: string; formats: Format[] }

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

const QUERY_ID = "0hWvDhmW8YQ-S_ib3AZIrQ";

let cachedGuestToken: string | null = null;
let cachedGuestTokenExpiry = 0;
let cachedBearerToken: string | null = null;

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

// ── Bearer token extraction from x.com homepage JS ──

async function getBearerToken(): Promise<string | null> {
  if (cachedBearerToken) return cachedBearerToken;
  try {
    const res = await fetch("https://x.com/", {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    });
    const html = await res.text();

    // Look for the AAAA… bearer pattern directly
    let match = html.match(/AAAAA[0-9A-Za-z_%\-]{50,200}/);
    if (match) { cachedBearerToken = match[0]; return cachedBearerToken; }

    // Search JS bundles referenced from the page
    const jsUrls = [...html.matchAll(/https:\/\/abs\.twimg\.com\/[^"'\s]*\.js/g)].map(m => m[0]);
    for (const jsUrl of jsUrls.slice(0, 5)) {
      try {
        const jsRes = await fetch(jsUrl, { headers: { "User-Agent": UA } });
        const js = await jsRes.text();
        match = js.match(/AAAAA[0-9A-Za-z_%\-]{50,200}/);
        if (match) { cachedBearerToken = match[0]; return cachedBearerToken; }
      } catch { /* continue */ }
    }
  } catch { /* ignore */ }
  return null;
}

// ── Guest token ──

async function getGuestToken(bearer: string): Promise<string | null> {
  const now = Date.now();
  if (cachedGuestToken && now < cachedGuestTokenExpiry) return cachedGuestToken;
  try {
    const res = await fetch("https://api.twitter.com/1.1/guest/activate.json", {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "User-Agent": UA },
    });
    if (!res.ok) return null;
    const data = await res.json() as { guest_token?: string };
    if (data.guest_token) {
      cachedGuestToken = data.guest_token;
      cachedGuestTokenExpiry = now + 25 * 60 * 1000;
      return cachedGuestToken;
    }
  } catch { /* ignore */ }
  return null;
}

// ── GraphQL query ──

async function fetchTweetGraphQL(
  tweetId: string, bearer: string, guestToken: string,
): Promise<Media[] | null> {
  const variables = encodeURIComponent(JSON.stringify({
    focalTweetId: tweetId,
    with_rux_injections: false,
    rankingMode: "Basic",
    includePromotedContent: false,
    withCommunity: false,
    withQuickPromoteEligibilityTweetFields: false,
    withBirdwatchNotes: false,
    withVoice: false,
  }));
  const features = encodeURIComponent(JSON.stringify({
    tweets: { enabled: true, version: "v3" },
    articles_preview_enabled: true,
    view_counts_everywhere_api_enabled: true,
    mediaDownloadEntity: { enabled: true, version: "v2" },
    rweb_tipjar_consumption_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql: true,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_public_visibility_enabled: true,
    longform_notetweets_richtext_consumption_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  }));
  const fieldToggles = encodeURIComponent(JSON.stringify({ withArticleRichContentState: false }));

  const url = `https://twitter.com/i/api/graphql/${QUERY_ID}/TweetDetail?variables=${variables}&features=${features}&fieldToggles=${fieldToggles}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      "X-Guest-Token": guestToken,
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) return null;

  return parseGraphQLTweet(await res.json());
}

function parseGraphQLTweet(data: any): Media[] | null {
  const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions || [];
  let tweet: any = null;
  for (const instr of instructions) {
    if (instr.type === "TimelineAddEntries") {
      for (const entry of instr.entries || []) {
        const result = entry?.content?.itemContent?.tweet_results?.result;
        if (result?.__typename === "Tweet") { tweet = result; break; }
      }
    }
    if (tweet) break;
  }
  if (!tweet) return null;

  const legacy = tweet.legacy || {};
  const text = (legacy.full_text || "").slice(0, 60) || "X 媒体";
  const media = buildMedia(legacy, text);
  return media.length > 0 ? media : null;
}

// ── Page scraping fallback ──

function extractBalancedJson(str: string, startPos: number): string | null {
  if (str[startPos] !== "{") return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = startPos; i < str.length; i++) {
    const ch = str[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"' && !escaped) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return str.slice(startPos, i + 1); }
  }
  return null;
}

function extractFromPage(html: string): Media[] | null {
  // __NEXT_DATA__ (legacy format)
  const ndMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (ndMatch) {
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
      if (tweet) {
        const legacy = tweet.legacy || {};
        const text = (legacy.full_text || "").slice(0, 60) || "X 媒体";
        const media = buildMedia(legacy, text);
        if (media.length > 0) return media;
      }
    } catch { /* skip */ }
  }

  // TSR / Relay dehydrated format
  if (html.includes("extended_entities")) {
    const results: any[] = [];
    let searchPos = 0;
    while (true) {
      const idx = html.indexOf('__typename":"LegacyTweet"', searchPos);
      if (idx === -1) break;
      const before = html.lastIndexOf("{", Math.max(0, idx - 50));
      searchPos = idx + 1;
      if (before === -1) continue;
      const jsonStr = extractBalancedJson(html, before);
      if (!jsonStr) continue;
      try {
        const obj = JSON.parse(jsonStr);
        if (obj.extended_entities) results.push(obj);
      } catch { /* skip */ }
    }
    const all: Media[] = [];
    for (const obj of results) {
      const text = (obj.full_text || "").slice(0, 60) || "X 媒体";
      all.push(...buildMedia(obj, text));
    }
    if (all.length > 0) return all;
  }

  return null;
}

async function scrapePage(url: string): Promise<{ media: Media[] | null; status: number }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) return { media: null, status: res.status };
  const html = await res.text();
  return { media: extractFromPage(html), status: 200 };
}

// ── Main handler ──

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

    // Method 1: Guest token + GraphQL
    const bearer = await getBearerToken();
    if (bearer) {
      const guestToken = await getGuestToken(bearer);
      if (guestToken) {
        const media = await fetchTweetGraphQL(tweetId, bearer, guestToken);
        if (media && media.length > 0) return NextResponse.json({ data: media });
        diagnostics.push("graphql: " + (media ? "no-media" : "null"));
      } else {
        diagnostics.push("graphql: no-guest-token");
      }
    } else {
      diagnostics.push("graphql: no-bearer");
    }

    // Method 2: Page scraping
    const pageResult = await scrapePage(`https://x.com/${username}/status/${tweetId}`);
    if (pageResult.media && pageResult.media.length > 0)
      return NextResponse.json({ data: pageResult.media });

    const iResult = await scrapePage(`https://x.com/i/status/${tweetId}`);
    if (iResult.media && iResult.media.length > 0)
      return NextResponse.json({ data: iResult.media });

    diagnostics.push(`page: HTTP ${pageResult.status}`, `i_page: HTTP ${iResult.status}`);

    return NextResponse.json(
      { error: "该推文中没有检测到视频或图片，推文可能不存在或为私密账号", diagnostics },
      { status: 400 },
    );
  } catch (e: any) {
    return NextResponse.json({ error: `解析失败: ${e.message}` }, { status: 500 });
  }
}
