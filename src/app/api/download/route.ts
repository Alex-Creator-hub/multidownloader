import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `upstream responded ${resp.status}` },
        { status: 502 }
      );
    }

    const contentLength = resp.headers.get("content-length");
    const contentType = resp.headers.get("content-type") ?? "application/octet-stream";

    return new NextResponse(resp.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": contentLength ?? "",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
