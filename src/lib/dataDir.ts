import path from "path";

export function getWritableBaseDir() {
  const cwd = process.cwd();
  if (process.env.VERCEL || cwd.startsWith("/var/task")) return "/tmp";
  return cwd;
}

export function getDataDir() {
  return path.join(getWritableBaseDir(), ".data");
}

export function dataPath(...parts: string[]) {
  return path.join(getDataDir(), ...parts);
}
