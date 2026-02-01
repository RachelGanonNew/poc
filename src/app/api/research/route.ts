import { NextRequest, NextResponse } from "next/server";
import { getOmniContext } from "@/lib/omnisenseStore";

// Simple public-web enrichment using Wikipedia summary API
// GET /api/research?name=Elon%20Musk
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = (searchParams.get("name") || "").trim();
    if (!name) return NextResponse.json({ error: "missing_name" }, { status: 400 });

    const { preferences } = getOmniContext();
    const privacy = preferences?.privacyMode || "cloud";
    if (privacy === "off") return NextResponse.json({ error: "privacy_off" }, { status: 403 });
    if (privacy === "local") {
      return NextResponse.json({ source: "local", summary: `Local mode: cannot fetch web for ${name}.` });
    }

    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;
    const res = await fetch(url, { headers: { "accept": "application/json" } });
    if (!res.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const j = await res.json();
    const out = {
      title: j.title,
      description: j.description,
      extract: j.extract,
      url: j.content_urls?.desktop?.page || j.content_urls?.mobile?.page,
      source: "wikipedia",
    };
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
