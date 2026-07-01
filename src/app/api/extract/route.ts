import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

interface Format { quality: string; url: string }
interface Media { type: "video" | "image"; title: string; previewUrl: string; formats: Format[] }

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

let cachedGuestToken: string | null = null;
let cachedGuestTokenExpiry = 0;

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

// ── Runtime token extraction ──
// The bearer token & guest token are obtained at runtime from x.com's own public
// web client. No secrets are hardcoded — this is what every browser visitor gets.

async function extractBearerFromHomepage(): Promise<string | null> {
  const html = await fetch("https://x.com/", {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  }).then(r => r.text());

  // x.com's main JS bundle contains the bearer token in pattern AAAA...
  const m = html.match(/AAAAA[0-9A-Za-z_%\-]{50,200}/);
  if (m) return m[0];

  // Also check linked JS bundles
  const jsUrls = [...html.matchAll(/https:\/\/abs\.twimg\.com\/[^"'\s]*\.js/g)].map(x => x[0]);
  for (const u of jsUrls.slice(0, 3)) {
    try {
      const js = await fetch(u, { headers: { "User-Agent": UA } }).then(r => r.text());
      const m2 = js.match(/AAAAA[0-9A-Za-z_%\-]{50,200}/);
      if (m2) return m2[0];
    } catch { /* skip */ }
  }

  return null;
}

async function getOrRefreshGuestToken(bearer: string): Promise<string | null> {
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

async function queryGraphQL(
  tweetId: string, bearer: string, guestToken: string,
): Promise<Media[] | null> {
  const variables = encodeURIComponent(JSON.stringify({
    focalTweetId: tweetId, with_rux_injections: false, rankingMode: "Basic",
    includePromotedContent: false, withCommunity: false,
    withQuickPromoteEligibilityTweetFields: false, withBirdwatchNotes: false, withVoice: false,
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
  const ft = encodeURIComponent(JSON.stringify({ withArticleRichContentState: false }));

  const url = `https://twitter.com/i/api/graphql/0hWvDhmW8YQ-S_ib3AZIrQ/TweetDetail?variables=${variables}&features=${features}&fieldToggles=${ft}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      "X-Guest-Token": guestToken,
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) return null;

  const data = await res.json() as any;
  const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions || [];
  for (const instr of instructions) {
    if (instr.type !== "TimelineAddEntries") continue;
    for (const entry of instr.entries || []) {
      const tweet = entry?.content?.itemContent?.tweet_results?.result;
      if (tweet?.__typename !== "Tweet") continue;
      const legacy = tweet.legacy || {};
      const text = (legacy.full_text || "").slice(0, 60) || "X 媒体";
      const media = buildMedia(legacy, text);
      if (media.length > 0) return media;
    }
  }
  return null;
}

// ── Page scraping fallback (for tweets with __NEXT_DATA__ or TSR dehydrated data) ──

function extractJson(str: string, start: number): string | null {
  if (str[start] !== "{") return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (esc) { esc = false; continue; }
    if (c === "\\" && inStr) { esc = true; continue; }
    if (c === '"' && !esc) { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return str.slice(start, i + 1); }
  }
  return null;
}

function tryParseNextData(html: string): Media[] | null {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    let tweet: any = d?.props?.pageProps?.tweetResult;
    if (tweet?.__typename !== "Tweet") tweet = null;
    if (!tweet) {
      for (const e of d?.props?.pageProps?.conversationThread?.instructions?.[0]?.entries || []) {
        const r = e?.content?.itemContent?.tweet_results?.result;
        if (r?.__typename === "Tweet") { tweet = r; break; }
      }
    }
    if (!tweet) return null;
    const l = tweet.legacy || {};
    const t = (l.full_text || "").slice(0, 60) || "X 媒体";
    return buildMedia(l, t);
  } catch { return null; }
}

function tryParseTSR(html: string): Media[] | null {
  if (!html.includes("extended_entities")) return null;
  const results: any[] = [];
  let pos = 0;
  while (true) {
    const idx = html.indexOf('__typename":"LegacyTweet"', pos);
    if (idx === -1) break;
    const before = html.lastIndexOf("{", Math.max(0, idx - 50));
    pos = idx + 1;
    if (before === -1) continue;
    const json = extractJson(html, before);
    if (!json) continue;
    try { const obj = JSON.parse(json); if (obj.extended_entities) results.push(obj); } catch { /* skip */ }
  }
  const all: Media[] = [];
  for (const obj of results) {
    const t = (obj.full_text || "").slice(0, 60) || "X 媒体";
    all.push(...buildMedia(obj, t));
  }
  return all.length > 0 ? all : null;
}

async function scrapePage(url: string): Promise<Media[] | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) return null;
  return tryParseNextData(await res.text()) ?? tryParseTSR(await res.text());
}

// ── Handler ──

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url || typeof url !== "string")
    return NextResponse.json({ error: "请输入链接" }, { status: 400 });

  const m = url.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/i);
  if (!m) return NextResponse.json({ error: "无法识别 X/Twitter 链接" }, { status: 400 });

  const [, username, tweetId] = m;

  try {
    // Method 1: Runtime Bearer extraction + Guest token + GraphQL
    const bearer = await extractBearerFromHomepage();
    if (bearer) {
      const guestToken = await getOrRefreshGuestToken(bearer);
      if (guestToken) {
        const media = await queryGraphQL(tweetId, bearer, guestToken);
        if (media && media.length > 0) return NextResponse.json({ data: media });
      }
    }

    // Method 2: Page scraping
    let media = await scrapePage(`https://x.com/${username}/status/${tweetId}`);
    if (media && media.length > 0) return NextResponse.json({ data: media });

    media = await scrapePage(`https://x.com/i/status/${tweetId}`);
    if (media && media.length > 0) return NextResponse.json({ data: media });

    return NextResponse.json(
      { error: "该推文中没有检测到视频或图片，推文可能不存在或为私密账号" },
      { status: 400 },
    );
  } catch (e: any) {
    return NextResponse.json({ error: `解析失败: ${e.message}` }, { status: 500 });
  }
}
