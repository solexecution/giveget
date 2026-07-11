import sharp from "sharp";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

export const PHOTOS_DIR = process.env.GIVEGET_PHOTOS_DIR ?? "./data/photos";
mkdirSync(PHOTOS_DIR, { recursive: true });

export const MAX_PHOTOS_PER_LISTING = 3;
const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 80;

export async function savePhoto(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Photo too large (max 10MB before resize).");
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const resized = await sharp(buf)
    .rotate()
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  const name = `${randomBytes(8).toString("hex")}.jpg`;
  writeFileSync(join(PHOTOS_DIR, name), resized);
  return name;
}

export function photoPath(name: string): string {
  return join(PHOTOS_DIR, name);
}

export function photoExists(name: string): boolean {
  // Only allow lowercase hex + .jpg to prevent traversal
  if (!/^[a-f0-9]{16}\.jpg$/.test(name)) return false;
  return existsSync(photoPath(name));
}
