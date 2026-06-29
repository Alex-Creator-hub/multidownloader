import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url)
    return NextResponse.json({ error: "url is required" }, { status: 400 });

  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    };

    const range = req.headers.get("range");
    if (range) headers["Range"] = range;

    const resp = await fetch(url, { headers });

    if (!resp.ok && resp.status !== 206) {
      return NextResponse.json(
        { error: `upstream responded ${resp.status}` },
        { status: 502 }
      );
    }

    const contentLength = resp.headers.get("content-length");
    const contentType = resp.headers.get("content-type") ?? "application/octet-stream";
    const contentRange = resp.headers.get("content-range");
    const acceptRanges = resp.headers.get("accept-ranges");

    const resHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
      "Cache-Control": "public, max-age=3600",
    };
    if (contentLength) resHeaders["Content-Length"] = contentLength;
    if (contentRange) resHeaders["Content-Range"] = contentRange;
    if (acceptRanges) resHeaders["Accept-Ranges"] = acceptRanges;

    return new NextResponse(resp.body, {
      status: resp.status,
      headers: resHeaders,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
