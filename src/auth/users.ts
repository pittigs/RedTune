import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface UserRecord {
  id: string;
  username: string;
  salt: string;
  hash: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export interface PublicUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export interface SessionRecord {
  token: string;
  userId: string;
  username: string;
  role: 'admin' | 'user';
  createdAt: number;
}

export class UserManager {
  private usersFile: string;
  private sessionsFile: string;
  private users: UserRecord[] = [];
  private sessions: Map<string, SessionRecord> = new Map();

  constructor(private readonly dataDir: string = './data') {
    this.usersFile = path.join(this.dataDir, 'users.json');
    this.sessionsFile = path.join(this.dataDir, 'sessions.json');

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.loadUsers();
    this.loadSessions();
  }

  private loadUsers(): void {
    try {
      if (fs.existsSync(this.usersFile)) {
        const raw = fs.readFileSync(this.usersFile, 'utf-8');
        this.users = JSON.parse(raw);
      } else {
        this.users = [];
      }
    } catch (err) {
      console.error('[Auth] Fehler beim Laden von users.json:', err);
      this.users = [];
    }
  }

  private saveUsers(): void {
    try {
      fs.writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Auth] Fehler beim Speichern von users.json:', err);
    }
  }

  private loadSessions(): void {
    try {
      if (fs.existsSync(this.sessionsFile)) {
        const raw = fs.readFileSync(this.sessionsFile, 'utf-8');
        const list: SessionRecord[] = JSON.parse(raw);
        const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 Tage Gültigkeit
        const now = Date.now();

        for (const s of list) {
          if (now - s.createdAt < maxAge) {
            this.sessions.set(s.token, s);
          }
        }
      }
    } catch (err) {
      console.error('[Auth] Fehler beim Laden von sessions.json:', err);
      this.sessions.clear();
    }
  }

  private saveSessions(): void {
    try {
      const list = Array.from(this.sessions.values());
      fs.writeFileSync(this.sessionsFile, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Auth] Fehler beim Speichern von sessions.json:', err);
    }
  }

  public hasUsers(): boolean {
    return this.users.length > 0;
  }

  public getUserCount(): number {
    return this.users.length;
  }

  private hashPassword(password: string, salt: string): string {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  public async createUser(username: string, password: string, role: 'admin' | 'user' = 'admin'): Promise<PublicUser> {
    const trimmedUser = username.trim();
    if (trimmedUser.length < 3) {
      throw new Error('Der Benutzername muss mindestens 3 Zeichen lang sein.');
    }

    if (!/^[a-zA-Z0-9_\-\.]+$/.test(trimmedUser)) {
      throw new Error('Der Benutzername darf nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten.');
    }

    if (!password || password.length < 6) {
      throw new Error('Das Passwort muss mindestens 6 Zeichen lang sein.');
    }

    const existing = this.users.find(u => u.username.toLowerCase() === trimmedUser.toLowerCase());
    if (existing) {
      throw new Error(`Benutzer "${trimmedUser}" existiert bereits.`);
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = this.hashPassword(password, salt);

    const newUser: UserRecord = {
      id: crypto.randomUUID(),
      username: trimmedUser,
      salt,
      hash,
      role,
      createdAt: new Date().toISOString()
    };

    this.users.push(newUser);
    this.saveUsers();
    console.log(`[Auth] Neuer Benutzer "${newUser.username}" (${newUser.role}) erfolgreich angelegt.`);

    return {
      id: newUser.id,
      username: newUser.username,
      role: newUser.role,
      createdAt: newUser.createdAt
    };
  }

  public async verifyUser(username: string, password: string): Promise<PublicUser | null> {
    const trimmedUser = username.trim().toLowerCase();
    const user = this.users.find(u => u.username.toLowerCase() === trimmedUser);
    if (!user) {
      return null;
    }

    try {
      const testKey = crypto.scryptSync(password, user.salt, 64);
      const expectedKey = Buffer.from(user.hash, 'hex');

      if (crypto.timingSafeEqual(testKey, expectedKey)) {
        return {
          id: user.id,
          username: user.username,
          role: user.role,
          createdAt: user.createdAt
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  public createSession(user: PublicUser): string {
    const token = crypto.randomBytes(32).toString('hex');
    const session: SessionRecord = {
      token,
      userId: user.id,
      username: user.username,
      role: user.role,
      createdAt: Date.now()
    };

    this.sessions.set(token, session);
    this.saveSessions();
    return token;
  }

  public validateSession(token: string): SessionRecord | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;

    const maxAge = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - session.createdAt > maxAge) {
      this.sessions.delete(token);
      this.saveSessions();
      return null;
    }

    return session;
  }

  public invalidateSession(token: string): void {
    if (this.sessions.has(token)) {
      this.sessions.delete(token);
      this.saveSessions();
    }
  }

  public getUserById(id: string): PublicUser | null {
    const user = this.users.find(u => u.id === id);
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt
    };
  }
}
