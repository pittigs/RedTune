import fs from 'node:fs';
import path from 'node:path';

export function getYtdlpAuthArgs(dataDir: string, includeCookies: boolean = true): string[] {
  const args: string[] = [];
  const cacheDir = path.join(dataDir, '.cache');

  if (!fs.existsSync(cacheDir)) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
    } catch {}
  }
  args.push('--cache-dir', cacheDir);

  // Verhindert den fehlerhaften tv_downgraded / tv Client, der "The page needs to be reloaded" auslöst
  args.push('--extractor-args', 'youtube:player_client=default,-tv_downgraded,-tv');

  if (includeCookies) {
    const cookiesFile = path.join(dataDir, 'cookies.txt');
    if (fs.existsSync(cookiesFile)) {
      try {
        const stat = fs.statSync(cookiesFile);
        if (stat.size > 0) {
          args.push('--cookies', cookiesFile);
        }
      } catch {}
    }
  }

  return args;
}

export function hasCookiesFile(dataDir: string): boolean {
  const cookiesFile = path.join(dataDir, 'cookies.txt');
  if (!fs.existsSync(cookiesFile)) return false;
  try {
    return fs.statSync(cookiesFile).size > 0;
  } catch {
    return false;
  }
}
