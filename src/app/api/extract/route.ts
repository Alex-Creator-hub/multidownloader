import { NextRequest, NextResponse } from "next/server";

interface Format { quality: string; url: string }
interface Media { type: "video" | "image"; title: string; previewUrl: string; formats: Format[] }

const FX_API = "https://api.fxtwitter.com";

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url || typeof url !== "string")
    return NextResponse.json({ error: "请输入链接" }, { status: 400 });

  const tweetId = url.match(/status\/(\d+)/)?.[1];
  if (!tweetId)
    return NextResponse.json({ error: "无法识别 X/Twitter 链接，请使用 x.com/xxx/status/123 格式" }, { status: 400 });

  try {
    const res = await fetch(`${FX_API}/status/${tweetId}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const json = await res.json();

    if (!json.tweet) {
      return NextResponse.json({ error: `推文不存在或无法访问 (${json.message || "未知"})` }, { status: 404 });
    }

    const allMedia = json.tweet.media?.all || [];
    if (!allMedia.length) {
      return NextResponse.json({ error: "该推文中没有检测到视频或图片" }, { status: 400 });
    }

    const mediaList: Media[] = allMedia.map((m: any) => {
      if (m.type === "video" || m.type === "gif") {
        const variants: { bitrate: number; url: string }[] = (m.video?.variants || [])
          .filter((v: any) => v.url && v.bitrate)
          .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

        const formats: Format[] = variants.map((v) => {
          const label =
            v.bitrate >= 2_000_000 ? "高清 1080p" :
            v.bitrate >= 1_000_000 ? "高清 720p" :
            v.bitrate >= 500_000 ? "标清 480p" : "流畅 360p";
          return { quality: label, url: v.url };
        });

        return {
          type: "video",
          title: (json.tweet.text || "").slice(0, 60) || "X 视频",
          previewUrl: m.url || "",
          formats,
        };
      }
      return {
        type: "image",
        title: (json.tweet.text || "").slice(0, 60) || "X 图片",
        previewUrl: m.url || "",
        formats: [{ quality: "原图", url: m.url }],
      };
    });

    return NextResponse.json({ data: mediaList });
  } catch (e: any) {
    return NextResponse.json({ error: `解析失败: ${e.message}` }, { status: 500 });
  }
}
