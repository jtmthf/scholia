import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".collab");
const FILE = join(DIR, "credentials");

export interface SiteCredential {
  slug: string;
  shareUrl: string;
  token: string;
  /** Server the Site was created against. */
  server: string;
  createdAt: string;
}

export type CredentialStore = Record<string, SiteCredential>;

export async function loadCredentials(): Promise<CredentialStore> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as CredentialStore;
  } catch {
    return {};
  }
}

export async function saveCredential(cred: SiteCredential): Promise<void> {
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  const store = await loadCredentials();
  store[cred.slug] = cred;
  await writeFile(FILE, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
}

export const credentialsPath = FILE;
