import { NextRequest, NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

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

function qualityRank(q: string): number {
  const n = parseInt(q, 10);
  if (q.includes("4K")) return 2160;
  if (q.includes("2K")) return 1440;
  return isNaN(n) ? 0 : n;
}

function detectPlatform(url: string): string {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/douyin\.com/i.test(url)) return "douyin";
  if (/xiaohongshu\.com|xhslink\.com/i.test(url)) return "xiaohongshu";
  if (/kuaishou\.com/i.test(url)) return "kuaishou";
  if (/twitter\.com|x\.com/i.test(url)) return "twitter";
  return "unknown";
}

/* ─── YouTube parser (pure JS, works on Vercel) ─── */
async function parseYouTube(url: string): Promise<Media[]> {
  const info = await ytdl.getInfo(url);

  const formats = info.formats
    .filter((f) => f.hasVideo && f.hasAudio && f.url)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

  const seen = new Set<string>();
  const result: Format[] = [];

  for (const f of formats) {
    const label = f.qualityLabel || `${f.height}p`;
    const q = label.replace(/[^0-9pK]/g, "");
    if (seen.has(q)) continue;
    seen.add(q);
    result.push({ quality: q, url: f.url! });
  }

  return [
    {
      type: "video",
      title: info.videoDetails.title,
      previewUrl: info.videoDetails.thumbnails?.slice(-1)[0]?.url ?? "",
      formats: result.sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality)),
    },
  ];
}

/* ─── POST ─── */
export async function POST(req: NextRequest) {
  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "请输入链接" }, { status: 400 });
  }

  const platform = detectPlatform(url);

  try {
    if (platform === "youtube") {
      const data = await parseYouTube(url);
      return NextResponse.json({ data });
    }

    // X/Twitter — try using a public API
    if (platform === "twitter") {
      try {
        const res = await fetch(
          `https://api.fxtwitter.com/status/${extractTweetId(url)}`,
          { headers: { "User-Agent": "multidownloader/1.0" } }
        );
        const json = await res.json();
        if (json?.tweet?.media?.all?.length > 0) {
          const mediaList: Media[] = json.tweet.media.all.map((m: any) => ({
            type: m.type === "video" ? "video" : "image",
            title: json.tweet.text?.slice(0, 80) || "X 媒体",
            previewUrl: m.url || "",
            formats:
              m.type === "video"
                ? (m.video?.bitrate
                    ? Object.entries(m.video)
                        .filter(([k]) => k !== "thumbnail")
                        .map(([k, v]: [string, any]) => ({
                          quality: k,
                          url: v.url || v,
                        }))
                    : [{ quality: "原画", url: m.url || "" }])
                : [{ quality: "原图", url: m.url || "" }],
          }));
          if (mediaList.length) return NextResponse.json({ data: mediaList });
        }
      } catch {}
    }

    // For platforms that need cookies (douyin, xiaohongshu, etc.)
    return NextResponse.json(
      {
        error:
          platform === "douyin" || platform === "xiaohongshu" || platform === "kuaishou"
            ? `抱歉，${platform === "douyin" ? "抖音" : platform === "xiaohongshu" ? "小红书" : "快手"}暂时无法在线解析。建议在本地服务器使用 yt-dlp 解析`
            : "无法识别该链接，目前支持 YouTube 和 X (Twitter)",
      },
      { status: 400 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: `解析失败: ${e.message}` }, { status: 500 });
  }
}

function extractTweetId(url: string): string {
  const m = url.match(/status\/(\d+)/);
  return m ? m[1] : "";
}
