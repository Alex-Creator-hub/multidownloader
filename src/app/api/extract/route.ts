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

function extractTweet(data: any): any {
  // Direct tweet result
  const tr = data?.props?.pageProps?.tweetResult;
  if (tr?.__typename === "Tweet") return tr;

  // From conversation thread
  for (const entry of data?.props?.pageProps?.conversationThread?.instructions?.[0]?.entries || []) {
    const r = entry?.content?.itemContent?.tweet_results?.result;
    if (r?.__typename === "Tweet") return r;
  }

  // From timeline entries (alternate page structure)
  for (const entry of data?.props?.pageProps?.timeline?.instructions?.[0]?.entries || []) {
    const r = entry?.content?.itemContent?.tweet_results?.result;
    if (r?.__typename === "Tweet") return r;
  }

  return null;
}

function parseMedia(legacy: any, text: string): Media[] | null {
  const rawMedia: any[] = legacy?.extended_entities?.media || [];
  if (!rawMedia.length) return null;

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

async function tryScrape(url: string): Promise<Media[] | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

  if (!res.ok) return null;

  const html = await res.text();

  // Try __NEXT_DATA__ extraction
  const ndMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (ndMatch) {
    try {
      const data = JSON.parse(ndMatch[1]);
      const tweet = extractTweet(data);
      if (tweet) {
        const legacy = tweet.legacy || {};
        const text = (legacy.full_text || "").slice(0, 60) || "X 媒体";
        const media = parseMedia(legacy, text);
        if (media) return media;
      }
    } catch {
      // Continue to next method
    }
  }

  return null;
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
    // Try multiple URL formats — x.com mobile, twitter.com mobile, and the /i/status page
    const urls = [
      `https://x.com/i/status/${tweetId}`,
      `https://mobile.twitter.com/i/status/${tweetId}`,
      `https://twitter.com/i/status/${tweetId}`,
    ];

    for (const u of urls) {
      const media = await tryScrape(u);
      if (media && media.length > 0)
        return NextResponse.json({ data: media });
    }

    return NextResponse.json(
      { error: "该推文中没有检测到视频或图片，推文可能不存在或为私密账号" },
      { status: 400 },
    );
  } catch (e: any) {
    return NextResponse.json({ error: `解析失败: ${e.message}` }, { status: 500 });
  }
}
