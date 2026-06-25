"use client";

/**
 * Per-client avatar/logo, used in the /clients grid and in the dashboard
 * header next to the client's name.
 *
 * Two modes:
 *
 *   1. Image mode (brand_logo_url set AND the image loads):
 *      Rounded-SQUARE container with the logo object-contain'd inside so any
 *      aspect ratio looks correct without distortion. The container backing is
 *      artwork-aware: we sample the logo's pixels client-side and classify its
 *      "ink" as light (white/pale on transparent), dark (dark on transparent),
 *      or solid (fills its own box). We then paint a CONTRASTING chip only on
 *      the theme where the artwork would otherwise blend into the page — a dark
 *      chip behind a light logo on the LIGHT theme, a light chip behind a dark
 *      logo on the DARK theme — plus a hair of padding so the artwork doesn't
 *      kiss the rim (see .ps-logo-chip[data-ink] in globals.css). Sampling is
 *      best-effort via a separate crossOrigin probe image; if it can't read the
 *      pixels (CORS-tainted) the ink stays "light", which reproduces the prior
 *      behavior (dark chip on the light theme only) — no regression.
 *
 *   2. Fallback mode (no brand_logo_url, OR the image fails to load):
 *      Rounded-square container filled with the client's brand_accent_color,
 *      the first letter of the client name centered in black. Defaults to
 *      Relay yellow if the client hasn't customized.
 *
 * Why a client component:
 *   A stored brand_logo_url can go dead — the Supabase Storage object gets
 *   deleted, a link expires — and a bare <img> would then render the
 *   browser's broken-image glyph forever. We watch for the load failing and
 *   fall through to the initial-letter circle instead. That needs an
 *   onError handler, which is client-only. It's still server-rendered to
 *   HTML (Next SSRs client components), so the avatar is in the first paint
 *   with no extra layout shift; only the error→fallback swap is client-side.
 *
 *   onError alone misses failures that happen BEFORE hydration (React won't
 *   replay them), so on mount we also reconcile against the image's decoded
 *   intrinsic size — a finished load with zero naturalWidth means broken.
 */
import { useEffect, useRef, useState } from "react";

/** How a logo's artwork sits on its (usually transparent) canvas:
 *   - "light" → pale/white ink → needs a dark chip on the LIGHT theme
 *   - "dark"  → dark ink → needs a light chip on the DARK theme
 *   - "solid" → fills its own box (low transparency) → just a hairline edge
 *  Drives the data-ink attribute the chip CSS keys off. */
type LogoInk = "light" | "dark" | "solid";

/** Classify a loaded image by sampling its pixels on a tiny offscreen canvas.
 *  Returns null if the canvas can't be read (cross-origin taint) so the caller
 *  keeps its default. Mean luminance over opaque pixels splits light vs dark;
 *  near-full opaque coverage means the logo carries its own background. */
function classifyLogoInk(img: HTMLImageElement): LogoInk | null {
  const N = 24;
  const canvas = document.createElement("canvas");
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, N, N);
  ctx.drawImage(img, 0, 0, N, N);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, N, N).data; // throws if the canvas is tainted
  } catch {
    return null;
  }
  let opaque = 0;
  let lumSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < 0.15) continue; // ignore (near-)transparent pixels
    opaque++;
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  if (opaque === 0) return null; // fully transparent — keep default
  const coverage = opaque / (N * N);
  if (coverage >= 0.88) return "solid";
  return lumSum / opaque >= 0.5 ? "light" : "dark";
}

type Props = {
  client: {
    name: string;
    slug: string;
    brand_logo_url?: string | null;
    brand_accent_color?: string | null;
  };
  /** Edge length in pixels. Defaults to 32 (typical for header/grid). */
  size?: number;
  className?: string;
};

export function ClientLogo({ client, size = 32, className = "" }: Props) {
  const src = client.brand_logo_url ?? null;
  // Track the URL that failed rather than a bare boolean: if this slot later
  // renders a *different* client/logo (e.g. switching clients in the header),
  // `erroredSrc !== src` is true again so the new image gets a fresh chance
  // instead of inheriting a stale "broken" flag.
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Detected artwork ink → drives the theme-aware chip backing (see globals).
  // Defaults to "light" (= the prior dark-chip-on-light behavior) until the
  // pixel probe reclassifies, or permanently if the probe can't read pixels.
  const [ink, setInk] = useState<LogoInk>("light");

  const initial = client.name.trim().charAt(0).toUpperCase() || "?";
  // Fall back to Relay yellow when the client hasn't picked a brand
  // color (or for the seed default, which is already #ff6a00).
  const bg = client.brand_accent_color || "#ff6a00";

  const showImage = !!src && erroredSrc !== src;

  // onError (below) covers failures after hydration; this covers the ones
  // before it — React can't replay an onError that fired on the SSR'd <img>
  // before its handler was attached. A finished load (`complete`) with zero
  // naturalWidth means the bytes failed to decode, i.e. broken.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) {
      setErroredSrc(src);
    }
  }, [src]);

  // Classify the artwork's ink so the chip can back it only where needed.
  // Uses a SEPARATE crossOrigin probe so the visible <img> (no crossOrigin)
  // always loads even when the host lacks CORS headers; the probe just fails
  // silently in that case and the ink stays at its "light" default.
  useEffect(() => {
    setInk("light"); // reset for a new/changed logo
    if (!src) return;
    let cancelled = false;
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      if (cancelled) return;
      const cls = classifyLogoInk(probe);
      if (cls) setInk(cls);
    };
    probe.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (showImage) {
    return (
      <span
        className={`ps-logo-chip relative inline-flex items-center justify-center rounded-[24%] overflow-hidden shrink-0 ${className}`}
        // data-ink selects the chip backing per theme (see globals.css). The
        // fill/ring/padding all come from those CSS rules — kept out of the
        // inline style so they can be theme- AND ink-conditional.
        data-ink={ink}
        style={
          {
            width: size,
            height: size,
            // Drives the inset padding (see .ps-logo-chip in globals.css).
            // It's a px-valued calc, NOT % padding — percentage padding on this
            // flex box collapses the w-full/h-full <img> to 0.
            "--logo-size": `${size}px`,
          } as React.CSSProperties
        }
        aria-hidden
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src ?? ""}
          alt=""
          className="object-contain w-full h-full"
          onError={() => setErroredSrc(src)}
        />
      </span>
    );
  }

  // Fallback initial circle. Black text on the brand color works for the
  // default yellow; if a client picks a dark accent color later, we can
  // switch the text color based on luminance — overkill for v1.
  return (
    <span
      className={`inline-flex items-center justify-center rounded-[24%] shrink-0 select-none ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        // Text size scales with the container, capped so giant avatars
        // don't get cartoonish letters.
        fontSize: Math.min(size * 0.5, 24),
        fontWeight: 700,
        color: "#000",
        lineHeight: 1,
      }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
