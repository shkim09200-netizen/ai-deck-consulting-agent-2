import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Cross-request storage adapter.
 *
 * The app must not assume a persistent local filesystem: on serverless hosts
 * (Vercel) the filesystem is read-only. All durable state — the per-user project
 * index, job snapshots, and generated docx/pptx — goes through this adapter.
 *
 *  - `R2_*` set               → Cloudflare R2 (S3-compatible; free tier)  ← preferred
 *  - `BLOB_READ_WRITE_TOKEN`  → Vercel Blob
 *  - otherwise                → local filesystem (dev), or /tmp on Vercel
 *
 * `presignPut` returns a URL the browser can PUT a file to directly (dodging the
 * serverless 4.5MB request-body limit); backends that can't do that return null
 * and the client falls back to sending the file inline.
 */
export interface Storage {
  putJson(key: string, value: unknown): Promise<void>;
  getJson<T = unknown>(key: string): Promise<T | null>;
  putBinary(key: string, data: Buffer, contentType: string): Promise<void>;
  getBinary(key: string): Promise<Buffer | null>;
  presignPut(key: string, contentType: string): Promise<string | null>;
}

const useR2 = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET
);
const useBlob = !useR2 && !!process.env.BLOB_READ_WRITE_TOKEN;

/* ------------------------- Cloudflare R2 (S3 API) -------------------------- */
function r2Storage(): Storage {
  const bucket = process.env.R2_BUCKET!;
  const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  let clientP: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;
  const getClient = () =>
    (clientP ??= (async () => {
      const { S3Client } = await import("@aws-sdk/client-s3");
      return new S3Client({
        region: "auto",
        endpoint,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID!,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        },
      });
    })());

  async function getBytes(key: string): Promise<Buffer | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const res = await (await getClient()).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await res.Body!.transformToByteArray();
      return Buffer.from(bytes);
    } catch {
      return null;
    }
  }
  async function putBytes(key: string, body: Buffer | string, contentType: string): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await getClient()).send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  return {
    putJson: (key, value) => putBytes(key, JSON.stringify(value), "application/json; charset=utf-8"),
    async getJson(key) {
      const b = await getBytes(key);
      if (!b) return null;
      try {
        return JSON.parse(b.toString("utf8")) as never;
      } catch {
        return null;
      }
    },
    putBinary: (key, data, contentType) => putBytes(key, data, contentType),
    getBinary: (key) => getBytes(key),
    async presignPut(key, contentType) {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      return getSignedUrl(
        await getClient(),
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        { expiresIn: 600 },
      );
    },
  };
}

/* --------------------------- Vercel Blob backend --------------------------- */
function blobStorage(): Storage {
  const sdk = () => import("@vercel/blob");
  async function urlFor(key: string): Promise<string | null> {
    const { list } = await sdk();
    const { blobs } = await list({ prefix: key, limit: 1 });
    return blobs.find((b) => b.pathname === key)?.url ?? null;
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
      return r.ok ? ((await r.json()) as never) : null;
    },
    async putBinary(key, data, contentType) {
      const { put } = await sdk();
      await put(key, data, { access: "public", contentType, addRandomSuffix: false, allowOverwrite: true });
    },
    async getBinary(key) {
      const url = await urlFor(key);
      if (!url) return null;
      const r = await fetch(url, { cache: "no-store" });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    },
    async presignPut() {
      return null; // Blob uses its own client upload; not wired here
    },
  };
}

/* ---------------------------- Filesystem backend --------------------------- */
function fsStorage(): Storage {
  const root = process.env.DECK_DATA_DIR
    ? path.resolve(process.env.DECK_DATA_DIR)
    : process.env.VERCEL
      ? path.join(os.tmpdir(), "deck-data")
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
    async presignPut() {
      return null; // no direct upload locally; the client sends files inline
    },
  };
}

export const storage: Storage = useR2 ? r2Storage() : useBlob ? blobStorage() : fsStorage();

/** Which backend is active — lets the upload route tell the client how to send
 *  large files directly (R2 presigned PUT vs Blob client upload vs inline). */
export const storageProvider: "r2" | "blob" | "fs" = useR2 ? "r2" : useBlob ? "blob" : "fs";

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
