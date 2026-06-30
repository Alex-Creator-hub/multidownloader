import { NextRequest, NextResponse } from "next/server";

interface Format { quality: string; url: string }
interface Media { type: "video" | "image"; title: string; previewUrl: string; formats: Format[] }

const BEARER = process.env.TWITTER_BEARER ??
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

function labelForBitrate(bps: number | undefined): string {
  if (!bps) return "原画";
  if (bps >= 2_000_000) return "高清 1080p";
  if (bps >= 1_000_000) return "高清 720p";
  if (bps >= 500_000) return "标清 480p";
  return "流畅 360p";
}

async function getGuestToken(): Promise<string> {
  const resp = await fetch("https://api.twitter.com/1.1/guest/activate.json", {
    method: "POST",
    headers: { Authorization: `Bearer ${BEARER}`, "User-Agent": "Mozilla/5.0" },
  });
  const json = await resp.json();
  return json.guest_token;
}

// Fetch tweet data via fxtwitter (fastest, proxied through Netlify)
async function tryFxtwitter(tweetId: string): Promise<Media[] | null> {
  const res = await fetch(`https://api.fxtwitter.com/status/${tweetId}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const json = await res.json();
  if (!json.tweet) return null;
  const all = json.tweet.media?.all || [];
  return all.map((m: any) => {
    if (m.type === "video" || m.type === "gif") {
      const variants = (m.video?.variants || [])
        .filter((v: any) => v.url && v.bitrate)
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
      return {
        type: "video" as const,
        title: (json.tweet.text || "").slice(0, 60) || "X 视频",
        previewUrl: m.url || "",
        formats: variants.map((v: any) => ({ quality: labelForBitrate(v.bitrate), url: v.url })),
      };
    }
    return {
      type: "image" as const,
      title: (json.tweet.text || "").slice(0, 60) || "X 图片",
      previewUrl: m.url || "",
      formats: [{ quality: "原图", url: m.url }],
    };
  });
}

// Fetch tweet data via Twitter GraphQL API
async function tryGraphQL(tweetId: string): Promise<Media[] | null> {
  const guestToken = await getGuestToken();
  const vars = encodeURIComponent(JSON.stringify({
    focalTweetId: tweetId,
    includePromotedContent: false,
    withCommunity: false,
    withVoice: false,
    withBirdwatchNotes: false,
  }));
  const feats = encodeURIComponent(JSON.stringify({
    responsive_web_graphql_exclude_directive_enabled: true,
    responsive_web_media_download_video_enabled: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: true,
  }));

  const res = await fetch(
    `https://x.com/i/api/graphql/QuBlAcZGWm8DqFCGsqtYiw/TweetDetail?variables=${vars}&features=${feats}`,
    {
      headers: {
        Authorization: `Bearer ${BEARER}`,
        "x-guest-token": guestToken,
        "x-twitter-client-language": "zh",
        "x-twitter-active-user": "yes",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
    }
  );
  if (!res.ok) return null;
  const json = await res.json();
  const instructions = json?.data?.threaded_conversation_with_injections_v2?.instructions || [];
  let result: any = null;
  for (const inst of instructions) {
    for (const entry of inst.entries || []) {
      const r = entry?.content?.itemContent?.tweet_results?.result;
      if (r?.__typename === "Tweet") { result = r; break; }
    }
    if (result) break;
  }
  if (!result) return null;
  const legacy = result.legacy || {};
  const rawMedia: any[] = legacy.extended_entities?.media || [];
  const title = (legacy.full_text || "").slice(0, 60) || "X 媒体";
  if (!rawMedia.length) return null;

  return rawMedia.map((m: any) => {
    if (m.type === "video" || m.type === "animated_gif") {
      const variants = (m.video_info?.variants || [])
        .filter((v: any) => v.bitrate && v.content_type === "video/mp4")
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
      return {
        type: "video" as const,
        title,
        previewUrl: m.media_url_https || "",
        formats: variants.map((v: any) => ({ quality: labelForBitrate(v.bitrate), url: v.url })),
      };
    }
    return {
      type: "image" as const,
      title,
      previewUrl: m.media_url_https || "",
      formats: [{ quality: "原图", url: m.media_url_https + "?name=orig" }],
    };
  });
}

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url || typeof url !== "string")
    return NextResponse.json({ error: "请输入链接" }, { status: 400 });

  const m = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i);
  if (!m)
    return NextResponse.json({ error: "无法识别 X/Twitter 链接" }, { status: 400 });

  const tweetId = m[1];

  try {
    const mediaList = (await tryFxtwitter(tweetId)) || (await tryGraphQL(tweetId));

    if (!mediaList || mediaList.length === 0) {
      return NextResponse.json(
        { error: "该推文中没有检测到视频或图片，推文可能不存在或为私密账号" },
        { status: 400 }
      );
    }

    return NextResponse.json({ data: mediaList });
  } catch (e: any) {
    return NextResponse.json({ error: `解析失败: ${e.message}` }, { status: 500 });
  }
}
