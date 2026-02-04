import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  try {
    const dir = path.join(process.cwd(), ".data", "verify");
    if (!fs.existsSync(dir)) return NextResponse.json({ items: [] });
    const names = fs.readdirSync(dir).filter((n) => n.endsWith(".html") || n.startsWith("run_"));
    const items = names.map((n) => ({ name: n, path: path.join(dir, n) }));
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
