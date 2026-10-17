import fs from 'node:fs';
import path from 'node:path';

export function getYtdlpAuthArgs(dataDir: string): string[] {
  const args: string[] = [];
  const cacheDir = path.join(dataDir, '.cache');

  if (!fs.existsSync(cacheDir)) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
    } catch {}
  }
  args.push('--cache-dir', cacheDir);

  const oauthMarker = path.join(dataDir, 'oauth_enabled');
  const cookiesFile = path.join(dataDir, 'cookies.txt');

  if (fs.existsSync(oauthMarker)) {
    args.push('--username', 'oauth2', '--password', '');
  } else if (fs.existsSync(cookiesFile)) {
    try {
      const stat = fs.statSync(cookiesFile);
      if (stat.size > 0) {
        args.push('--cookies', cookiesFile);
      }
    } catch {}
  }

  return args;
}

export function isOAuthEnabled(dataDir: string): boolean {
  return fs.existsSync(path.join(dataDir, 'oauth_enabled'));
}
