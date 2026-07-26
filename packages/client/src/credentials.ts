import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".scholia");
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

async function writeStore(store: CredentialStore): Promise<void> {
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  await writeFile(FILE, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
}

export async function saveCredential(cred: SiteCredential): Promise<void> {
  const store = await loadCredentials();
  store[cred.slug] = cred;
  await writeStore(store);
}

// Remove a stored credential by slug (after `scholia delete-site`, or the old slug
// after `scholia rotate-share`). No-op when absent.
export async function removeCredential(slug: string): Promise<void> {
  const store = await loadCredentials();
  if (!(slug in store)) return;
  delete store[slug];
  await writeStore(store);
}

export const credentialsPath = FILE;
