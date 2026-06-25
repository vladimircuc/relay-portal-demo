/**
 * HTML → PDF via headless Chromium.
 *
 *   dev (local mac):  drives the installed Google Chrome.
 *   prod (Vercel):    uses @sparticuz/chromium's bundled binary.
 *
 * setContent + waitUntil:"networkidle0" so async art (Google Fonts, the
 * Leaflet local-SEO map tiles) is fully loaded before we print.
 */
import puppeteer from "puppeteer-core";

const LOCAL_CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// @sparticuz/chromium-min ships NO binary (so the bundler/tracer can't drop it);
// the Chromium pack is fetched from this URL at runtime and cached in /tmp. Pin
// the pack version to the installed chromium-min version. Override with
// CHROMIUM_PACK_URL to self-host (faster cold starts, no GitHub dependency).
const CHROMIUM_PACK_URL =
  process.env.CHROMIUM_PACK_URL ||
  "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

export async function htmlToPdf(html: string): Promise<Buffer> {
  const isProd = process.env.NODE_ENV === "production";

  let launch: Parameters<typeof puppeteer.launch>[0];
  if (isProd) {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    // PDF rendering needs no WebGL — skip swiftshader to stay light in Lambda.
    chromium.setGraphicsMode = false;
    launch = {
      args: chromium.args,
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: true,
    };
  } else {
    launch = {
      args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
      executablePath: LOCAL_CHROME,
      headless: true,
    };
  }

  const browser = await puppeteer.launch({
    ...launch,
    defaultViewport: { width: 1100, height: 1400, deviceScaleFactor: 2 },
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 45000 });
    // wait for web fonts + any async art (Leaflet map tiles) to finish
    await page.evaluate(() => (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready).catch(() => {});
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 20000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
