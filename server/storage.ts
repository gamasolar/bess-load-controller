/**
 * Local filesystem storage helpers (replaces the original S3-backed module).
 *
 * Files are written under `./storage-data/` (resolved against process.cwd()).
 * Generated URLs point to `/storage/{key}`, which is served as a static
 * directory by `server/_core/index.ts`.
 *
 * The directory is created lazily on first write. Set the env variable
 * `STORAGE_DIR` to override the default location (useful when running under
 * systemd with a dedicated data volume).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function getStorageRoot(): string {
  const override = process.env.STORAGE_DIR;
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  return path.resolve(process.cwd(), "storage-data");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeKey(relKey: string): string {
  // Strip leading slashes and any traversal segments to keep paths inside the
  // storage root. We treat the key as a POSIX-style relative path.
  const trimmed = relKey.replace(/^\/+/, "");
  const safeParts = trimmed
    .split(/[/\\]+/)
    .filter((part) => part && part !== "." && part !== "..");
  return safeParts.join("/");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  // contentType is part of the legacy signature; for filesystem storage the
  // browser figures the type out from the extension when served statically.
  _contentType: string = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const storageRoot = getStorageRoot();
  ensureDir(storageRoot);

  const safeRelKey = normalizeKey(relKey);
  if (!safeRelKey) {
    throw new Error("storagePut: empty key after normalization");
  }
  const key = appendHashSuffix(safeRelKey);
  const filePath = path.join(storageRoot, key);
  ensureDir(path.dirname(filePath));

  const buffer =
    typeof data === "string"
      ? Buffer.from(data, "utf-8")
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);

  fs.writeFileSync(filePath, buffer);

  return { key, url: `/storage/${key}` };
}

export async function storageGet(
  relKey: string,
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/storage/${key}` };
}

/**
 * Backwards-compatible alias kept so that any caller still importing the
 * S3-presign helper resolves to a working URL. There is no signing in
 * filesystem storage; the caller gets the same public path as `storageGet`.
 */
export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);
  return `/storage/${key}`;
}
