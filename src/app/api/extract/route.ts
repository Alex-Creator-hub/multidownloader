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

const BEARER =
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
    headers: {
      Authorization: `Bearer ${BEARER}`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  const json = await resp.json();
  return json.guest_token;
}

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "请输入链接" }, { status: 400 });
  }

  const tweetId = url.match(/(?:status|x\.com\/\w+\/status)\/(\d+)/)?.[1];
  if (!tweetId) {
    return NextResponse.json(
      { error: "无法识别 X/Twitter 链接，请使用 x.com/xxx/status/123 格式" },
      { status: 400 }
    );
  }

  try {
    // Step 1: try fxtwitter (fast)
    let mediaList: Media[] | null = null;

    try {
      const fxRes = await fetch(`https://api.fxtwitter.com/status/${tweetId}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const fxJson = await fxRes.json();
      if (fxJson.tweet) {
        const all = fxJson.tweet.media?.all || [];
        mediaList = all.map((m: any) => {
          if (m.type === "video" || m.type === "gif") {
            const variants = (m.video?.variants || [])
              .filter((v: any) => v.url && v.bitrate)
              .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
            return {
              type: "video" as const,
              title: (fxJson.tweet.text || "").slice(0, 60) || "X 视频",
              previewUrl: m.url || "",
              formats: variants.map((v: any) => ({
                quality: labelForBitrate(v.bitrate),
                url: v.url,
              })),
            };
          }
          return {
            type: "image" as const,
            title: (fxJson.tweet.text || "").slice(0, 60) || "X 图片",
            previewUrl: m.url || "",
            formats: [{ quality: "原图", url: m.url }],
          };
        });
      }
    } catch {
      // fxtwitter failed, fall through to direct API
    }

    // Step 2: fallback to Twitter GraphQL API
    if (!mediaList) {
      const guestToken = await getGuestToken();
      const variables = encodeURIComponent(
        JSON.stringify({
          focalTweetId: tweetId,
          includePromotedContent: false,
          withCommunity: false,
          withVoice: false,
          withBirdwatchNotes: false,
          withQuickPromoteEligibilityTweetFields: false,
        })
      );
      const features = encodeURIComponent(
        JSON.stringify({
          responsive_web_graphql_exclude_directive_enabled: true,
          responsive_web_media_download_video_enabled: true,
          tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
          longform_notetweets_inline_media_enabled: true,
          responsive_web_enhance_cards_enabled: true,
        })
      );

      const gqlRes = await fetch(
        `https://x.com/i/api/graphql/QuBlAcZGWm8DqFCGsqtYiw/TweetDetail?variables=${variables}&features=${features}`,
        {
          headers: {
            Authorization: `Bearer ${BEARER}`,
            "x-guest-token": guestToken,
            "x-twitter-client-language": "zh",
            "x-twitter-active-user": "yes",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Accept: "*/*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          },
        }
      );

      if (!gqlRes.ok) {
        return NextResponse.json(
          { error: `X API 返回错误 (${gqlRes.status})，请确认链接有效` },
          { status: 502 }
        );
      }

      const gqlJson = await gqlRes.json();

      // Parse the nested response
      const instructions =
        gqlJson?.data?.threaded_conversation_with_injections_v2?.instructions || [];
      let tweetResult: any = null;

      for (const inst of instructions) {
        for (const entry of inst.entries || []) {
          const itemContent = entry?.content?.itemContent;
          const result = itemContent?.tweet_results?.result;
          if (result?.__typename === "Tweet") {
            tweetResult = result;
            break;
          }
        }
        if (tweetResult) break;
      }

      if (!tweetResult) {
        return NextResponse.json(
          { error: "无法获取推文数据，推文可能不存在或为私密账号" },
          { status: 404 }
        );
      }

      const legacy = tweetResult.legacy || {};
      const entities = legacy.extended_entities || {};
      const rawMedia: any[] = entities.media || [];
      const title = (legacy.full_text || "").slice(0, 60) || "X 媒体";

      if (!rawMedia.length) {
        return NextResponse.json(
          { error: "该推文中没有检测到视频或图片" },
          { status: 400 }
        );
      }

      mediaList = rawMedia.map((m: any) => {
        if (m.type === "video" || m.type === "animated_gif") {
          const variants = (m.video_info?.variants || [])
            .filter((v: any) => v.bitrate && v.content_type === "video/mp4")
            .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
          return {
            type: "video" as const,
            title,
            previewUrl: m.media_url_https || "",
            formats: variants.map((v: any) => ({
              quality: labelForBitrate(v.bitrate),
              url: v.url,
            })),
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

    if (!mediaList || mediaList.length === 0) {
      return NextResponse.json(
        { error: "该推文中没有检测到视频或图片" },
        { status: 400 }
      );
    }

    return NextResponse.json({ data: mediaList });
  } catch (e: any) {
    return NextResponse.json(
      { error: `解析失败: ${e.message}` },
      { status: 500 }
    );
  }
}
