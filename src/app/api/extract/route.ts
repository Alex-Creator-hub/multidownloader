import { NextRequest, NextResponse } from "next/server";

interface Format {
  quality: string;
  url: string;
}
interface Media {
  type: "video" | "image";
  title: string;
  previewUrl: string;
  formats: Format[];
}

/* ─── POST ─── */
export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url || typeof url !== "string")
    return NextResponse.json({ error: "请输入链接" }, { status: 400 });

  // Extract tweet ID
  const tweetId = url.match(/status\/(\d+)/)?.[1];
  if (!tweetId)
    return NextResponse.json({ error: "无法识别 X/Twitter 链接" }, { status: 400 });

  try {
    const res = await fetch(`https://api.fxtwitter.com/status/${tweetId}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const json = await res.json();

    if (!json?.tweet?.media?.all?.length) {
      return NextResponse.json({ error: "该推文中没有检测到视频或图片" }, { status: 400 });
    }

    const mediaList: Media[] = json.tweet.media.all.map((m: any) => {
      if (m.type === "video") {
        // fxtwitter returns video variants with bitrate
        const formats: Format[] = [];
        if (m.video?.variants) {
          for (const v of m.video.variants) {
            if (v.url && v.bitrate) {
              const label = v.bitrate >= 1000000 ? "高清" : v.bitrate >= 500000 ? "标清" : "流畅";
              formats.push({ quality: label, url: v.url });
            }
          }
        }
        if (!formats.length && m.url) {
          formats.push({ quality: "原画", url: m.url });
        }
        // Sort by bitrate descending
        formats.sort((a, b) => {
          const ra = a.quality === "高清" ? 3 : a.quality === "标清" ? 2 : 1;
          const rb = b.quality === "高清" ? 3 : b.quality === "标清" ? 2 : 1;
          return rb - ra;
        });
        return { type: "video", title: json.tweet.text?.slice(0, 60) || "X 视频", previewUrl: m.url || "", formats };
      }
      return { type: "image", title: json.tweet.text?.slice(0, 60) || "X 图片", previewUrl: m.url || "", formats: [{ quality: "原图", url: m.url }] };
    });

    return NextResponse.json({ data: mediaList });
  } catch (e: any) {
    return NextResponse.json({ error: `解析失败: ${e.message}` }, { status: 500 });
  }
}
