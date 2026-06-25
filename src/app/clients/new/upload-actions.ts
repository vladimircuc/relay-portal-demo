"use server";

/**
 * Server action for uploading a client brand logo to Supabase Storage.
 *
 * Used by the LogoUpload component on /clients/new (and could be reused
 * by a future edit-client form). Decoupled from the createClient action
 * so the upload happens immediately on file select — that way the user
 * sees an instant preview and a slow upload doesn't block typing the
 * rest of the form fields.
 *
 * Storage layout:
 *   client-logos/<slug>-<timestamp>.<ext>
 *
 * Timestamp suffix means re-uploading for the same slug produces a new
 * URL, so CDN cache invalidation isn't a concern. Orphaned older files
 * are fine — storage is cheap, and an archive/delete flow can clean up
 * later if needed.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { requireGlobalSuperAdmin } from "@/lib/auth";
import { assertWritable } from "@/lib/demo";

/** Max upload size in bytes. 2 MB is generous for a logo. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Allowed MIME types. SVG is deliberately excluded — they can contain
 * embedded scripts, which is a real XSS risk for a publicly-served
 * file. PNG / JPG / WEBP cover every realistic brand asset.
 */
const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export type UploadResult =
  | { url: string }
  | { error: string };

export async function uploadClientLogo(formData: FormData): Promise<UploadResult> {
  assertWritable("Upload client logo");
  await requireGlobalSuperAdmin();

  const file = formData.get("file");
  const slug = String(formData.get("slug") ?? "").trim();

  if (!(file instanceof File)) {
    return { error: "No file provided." };
  }
  if (file.size === 0) {
    return { error: "File is empty." };
  }
  if (file.size > MAX_BYTES) {
    return {
      error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep it under 2 MB.`,
    };
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return { error: "Use a PNG, JPG, or WEBP file." };
  }
  if (!slug || slug.length < 2) {
    return { error: "Slug must be set before uploading a logo." };
  }

  const supabase = createAdminClient();
  // Storage path: <slug>-<ms>.<ext>. Including the ms timestamp lets a
  // user re-upload the same slug without fighting CDN cache headers.
  const path = `${slug}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("client-logos")
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) {
    return { error: uploadError.message };
  }

  const { data: pub } = supabase.storage.from("client-logos").getPublicUrl(path);
  return { url: pub.publicUrl };
}
