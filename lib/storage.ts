import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Cross-request storage adapter.
 *
 * The app must not assume a persistent local filesystem: on serverless hosts
 * (Vercel) the filesystem is read-only and nothing written by one request is
 * visible to the next. So all durable state — the project index, job snapshots,
 * and generated docx/pptx files — goes through this adapter.
 *
 *  - When `BLOB_READ_WRITE_TOKEN` is set  → Vercel Blob (works on read-only FS).
 *  - Otherwise                            → local filesystem under
 *    `DECK_DATA_DIR` (or `<cwd>/.data`), so local dev keeps working unchanged.
 *
 * Keys are slash-delimited logical paths, e.g. `store.json`,
 * `jobs/<id>/job.json`, `jobs/<id>/<filename>.pptx`.
 */
export interface Storage {
  putJson(key: string, value: unknown): Promise<void>;
  getJson<T = unknown>(key: string): Promise<T | null>;
  putBinary(key: string, data: Buffer, contentType: string): Promise<void>;
  getBinary(key: string): Promise<Buffer | null>;
}

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

/* --------------------------- Vercel Blob backend --------------------------- */
function blobStorage(): Storage {
  // Imported lazily so environments without the token never load the SDK.
  const sdk = () => import("@vercel/blob");

  async function urlFor(key: string): Promise<string | null> {
    const { list } = await sdk();
    // `list` is the reliable way to resolve a pathname → public URL (head()
    // expects a full URL in this SDK version).
    const { blobs } = await list({ prefix: key, limit: 1 });
    const exact = blobs.find((b) => b.pathname === key);
    return exact?.url ?? null;
  }

  return {
    async putJson(key, value) {
      const { put } = await sdk();
      await put(key, JSON.stringify(value), {
        access: "public",
        contentType: "application/json; charset=utf-8",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    },
    async getJson(key) {
      const url = await urlFor(key);
      if (!url) return null;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return null;
      return (await r.json()) as never;
    },
    async putBinary(key, data, contentType) {
      const { put } = await sdk();
      await put(key, data, {
        access: "public",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    },
    async getBinary(key) {
      const url = await urlFor(key);
      if (!url) return null;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return null;
      return Buffer.from(await r.arrayBuffer());
    },
  };
}

/* ---------------------------- Filesystem backend --------------------------- */
function fsStorage(): Storage {
  const root = process.env.DECK_DATA_DIR
    ? path.resolve(process.env.DECK_DATA_DIR)
    : path.join(process.cwd(), ".data");
  const full = (key: string) => path.join(root, key);
  const ensureDir = (p: string) => mkdir(path.dirname(p), { recursive: true });

  return {
    async putJson(key, value) {
      const p = full(key);
      await ensureDir(p);
      await writeFile(p, JSON.stringify(value, null, 2), "utf8");
    },
    async getJson(key) {
      try {
        return JSON.parse(await readFile(full(key), "utf8")) as never;
      } catch {
        return null;
      }
    },
    async putBinary(key, data) {
      const p = full(key);
      await ensureDir(p);
      await writeFile(p, data);
    },
    async getBinary(key) {
      try {
        return await readFile(full(key));
      } catch {
        return null;
      }
    },
  };
}

export const storage: Storage = useBlob ? blobStorage() : fsStorage();

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
