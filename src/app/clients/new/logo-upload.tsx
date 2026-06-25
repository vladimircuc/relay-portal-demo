"use client";

/**
 * Drag-and-drop logo upload with live preview.
 *
 * UX flow:
 *   1. Empty state — dashed drop zone with a "Drag & drop or browse"
 *      label. Clicking anywhere on the zone opens the file picker.
 *   2. Drop / select — file is uploaded immediately via the
 *      uploadClientLogo server action; the parent form keeps typing
 *      while the upload runs. Spinner overlays the zone during upload.
 *   3. Success — preview thumbnail of the uploaded image, "Replace"
 *      and "Remove" links. The returned public URL is stored in a
 *      hidden `brand_logo_url` input so the surrounding form submits
 *      it along with the rest of the create-client fields.
 *   4. Error — inline error message under the zone, file cleared, can
 *      retry immediately.
 *
 * The slug is required server-side (we need it to build the storage
 * path), so we read it from a sibling form input via the parent's
 * `getSlug` callback right before uploading. If the user hasn't typed
 * a slug yet, we surface a friendly error instead of silently failing.
 */
import { useRef, useState, useTransition } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { uploadClientLogo } from "./upload-actions";

type Props = {
  /** Called when we need the current slug (read live from sibling input). */
  getSlug: () => string;
  /** Initial URL if rehydrating from a previous submission attempt. */
  initialUrl?: string;
};

export function LogoUpload({ getSlug, initialUrl }: Props) {
  const [url, setUrl] = useState<string>(initialUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    setError(null);

    const slug = getSlug();
    if (!slug || slug.length < 2) {
      setError("Fill in the name / slug field first, then upload.");
      return;
    }

    // Quick client-side validation so obvious problems don't even hit
    // the server. The server re-validates as defence in depth.
    if (!file.type.startsWith("image/")) {
      setError("That's not an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep it under 2 MB.`);
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("slug", slug);
      const result = await uploadClientLogo(formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        setUrl(result.url);
      }
    });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Clear the input so re-selecting the same file fires onChange again.
    e.target.value = "";
  }

  function clear() {
    setUrl("");
    setError(null);
  }

  // ── Rendered states ─────────────────────────────────────────────────────

  if (url) {
    return (
      <div className="flex flex-col gap-2">
        <input type="hidden" name="brand_logo_url" value={url} />
        <div className="flex items-center gap-4 bg-[var(--surface-2)]/60 border border-[var(--surface-3)]/60 rounded-md p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Logo preview"
            className="h-14 w-14 rounded-md object-contain bg-[var(--surface-1)]"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[var(--text-primary)]">
              Logo uploaded
            </div>
            <div className="text-[11px] text-[var(--text-tertiary)] truncate font-mono">
              {url.split("/").pop()}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={clear}
              className="text-[12px] text-[var(--text-tertiary)] hover:text-[var(--negative)] underline-offset-2 hover:underline inline-flex items-center gap-1"
            >
              <X size={12} />
              Remove
            </button>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={onInputChange}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Hidden empty input keeps the form field present even when no
          logo is uploaded — the createClient action handles "" as null. */}
      <input type="hidden" name="brand_logo_url" value="" />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDraggingOver(true);
        }}
        onDragLeave={() => setDraggingOver(false)}
        onDrop={onDrop}
        onClick={() => !pending && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !pending) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={cn(
          "relative flex flex-col items-center justify-center gap-2 px-6 py-8 rounded-md border-2 border-dashed cursor-pointer transition-colors",
          draggingOver
            ? "border-[var(--ps-yellow)] bg-[var(--ps-yellow)]/5"
            : "border-[var(--surface-3)]/60 hover:border-[var(--surface-3)] bg-[var(--surface-2)]/30",
          pending && "pointer-events-none opacity-60",
        )}
      >
        {pending ? (
          <Loader2 size={20} className="animate-spin text-[var(--text-secondary)]" />
        ) : (
          <ImagePlus size={20} className="text-[var(--text-tertiary)]" />
        )}
        <div className="text-sm text-[var(--text-secondary)]">
          {pending ? (
            "Uploading…"
          ) : (
            <>
              <span className="font-medium text-[var(--text-primary)]">
                Drag & drop
              </span>{" "}
              a logo, or click to browse
            </>
          )}
        </div>
        <div className="text-[11px] text-[var(--text-tertiary)]">
          PNG, JPG, or WEBP up to 2 MB
        </div>
      </div>

      {error && (
        <div className="text-[12px] text-[var(--negative)]">{error}</div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}
