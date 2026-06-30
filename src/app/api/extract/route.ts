import { NextRequest, NextResponse } from "next/server";

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

async function scrapeTweetPage(tweetId: string): Promise<Media[] | null> {
  const url = `https://x.com/i/status/${tweetId}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    redirect: "follow",
  });

  const html = await res.text();

  // Diagnostic: log first 500 chars
  console.log("FETCH status:", res.status, "url:", res.url, "html preview:", html.slice(0, 500));

  const ndMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!ndMatch) {
    console.log("__NEXT_DATA__ not found in HTML");
    return null;
  }

  try {
    const data = JSON.parse(ndMatch[1]);
    const pageProps = data?.props?.pageProps;
    console.log("pageProps keys:", Object.keys(pageProps || {}));

    let tweet: any = null;
    const tweetResult = pageProps?.tweetResult;
    if (tweetResult?.__typename === "Tweet") tweet = tweetResult;

    if (!tweet) {
      const entries = pageProps?.conversationThread?.instructions?.[0]?.entries;
      if (entries) {
        console.log("entries count:", entries.length);
        for (const entry of entries) {
          const r = entry?.content?.itemContent?.tweet_results?.result;
          console.log("entry result __typename:", r?.__typename);
          if (r?.__typename === "Tweet") { tweet = r; break; }
        }
      }
    }

    if (!tweet) {
      console.log("No tweet found in NextData");
      return null;
    }

    const legacy = tweet.legacy || {};
    const text = (legacy.full_text || "").slice(0, 60) || "X 媒体";
    const rawMedia: any[] = legacy.extended_entities?.media || [];
    console.log("media count:", rawMedia.length);

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
  } catch (e: any) {
    console.error("Parse error:", e.message);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url || typeof url !== "string")
    return NextResponse.json({ error: "请输入链接" }, { status: 400 });

  const m = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/i);
  if (!m)
    return NextResponse.json({ error: "无法识别 X/Twitter 链接" }, { status: 400 });

  try {
    const mediaList = await scrapeTweetPage(m[1]);

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
