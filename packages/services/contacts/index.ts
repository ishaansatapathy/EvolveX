export type ThreadContact = {
  id: string;
  email: string;
  displayName?: string;
  handle: string;
  source: "manual" | "inbox" | "sent" | "agent";
  lastUsedAt?: string;
};

export function normalizeContactHandle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 80);
}

export function deriveContactHandle(email: string, displayName?: string | null) {
  const fromName = displayName?.trim();
  if (fromName) {
    const first = fromName.split(/\s+/)[0] ?? fromName;
    const handle = normalizeContactHandle(first);
    if (handle.length >= 2) return handle;
  }
  const local = email.split("@")[0] ?? email;
  return normalizeContactHandle(local) || "contact";
}

export interface ContactsService {
  search(userId: string, query: string, limit?: number): Promise<ThreadContact[]>;
  upsert(
    userId: string,
    input: { email: string; displayName?: string; source?: ThreadContact["source"] },
  ): Promise<ThreadContact>;
  syncFromInbox(userId: string): Promise<{ imported: number; fromCache: number; fromLive: number }>;
  /** Paginate entire INBOX and upsert unique senders (for @mention backfill). */
  syncInboxBatch(
    userId: string,
    opts?: { pageToken?: string; pageSize?: number },
  ): Promise<{
    imported: number;
    threadsScanned: number;
    nextPageToken?: string;
    done: boolean;
    resultSizeEstimate?: number;
  }>;
  touch(userId: string, email: string): Promise<void>;
}

let contactsService: ContactsService | null = null;

export function registerContactsService(service: ContactsService) {
  contactsService = service;
}

export function getContactsService(): ContactsService {
  if (!contactsService) {
    throw new Error("Contacts service is not registered");
  }
  return contactsService;
}
