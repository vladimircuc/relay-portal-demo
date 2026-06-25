/**
 * Combined print stylesheet for the PDF report. Ported verbatim from the
 * approved prototypes (report-proto/*.html). Shared content-page primitives
 * live under `.rpage`; the cover is `.cover`; each service page adds its own
 * specifics under `.ads` / `.social` / `.seo` / `.local`.
 *
 * NO box-shadow anywhere — Chrome rasterizes soft shadows into hard grey
 * blocks in print/Preview. Use borders / pseudo-element bars instead.
 */
export const REPORT_STYLES = /* css */ `
  :root{
    --y:#ff6a00; --y-dark:#E0B800; --ink:#0f0f10; --ink-2:#26262b;
    --muted:#6b7280; --muted-2:#9aa0a8; --line:#e8e8ea; --soft:#f2f2f2;
    --green:#15a34a; --red:#dc2626; --amber:#f59e0b; --gray:#6b7280;
  }
  @page { size: Letter; margin: 0; }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{
    font-family:'Montserrat', -apple-system, system-ui, sans-serif;
    color:var(--ink); background:#fff;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  .page{ position:relative; width:8.5in; height:11in; overflow:hidden; background:#fff; }

  /* shared footer */
  .foot{ position:absolute; left:0; right:0; bottom:0; padding:0 0.7in 0.42in; z-index:1; }
  .foot .rule{ height:2.5px; background:var(--y); border-radius:2px; margin-bottom:9px; }
  .foot .frow{ display:flex; justify-content:space-between; align-items:center; font-size:9.5px; color:var(--muted-2); letter-spacing:.02em; }
  .foot .frow b{ color:var(--muted); font-weight:600; }

  /* shared delta pills */
  .delta{ display:inline-flex; align-items:center; gap:3px; font-size:10px; font-weight:700; line-height:1; }
  .delta .arw{ font-size:8px; line-height:1; position:relative; top:-0.5px; }
  .delta.good{ color:var(--green); } .delta.bad{ color:var(--red); } .delta.flat{ color:var(--muted-2); }

  /* ===== shared content-page primitives (.rpage) ===== */
  .rpage .watermark{ position:absolute; right:-0.55in; bottom:-0.4in; width:3.9in; height:auto; opacity:.05; z-index:0; pointer-events:none; }
  .rpage .phead{ position:relative; z-index:1; padding:0.42in 0.7in 0; }
  .rpage .phead .accent-bar{ position:absolute; right:0; top:0; width:2.05in; height:0.16in; background:var(--y); }
  .rpage .phead .logo{ width:145px; height:auto; display:block; }
  .rpage .content{ position:relative; z-index:1; padding:0 0.7in; }
  .rpage .eyebrow{ font-size:10.5px; font-weight:700; letter-spacing:.22em; text-transform:uppercase; color:var(--muted); margin:18px 0 7px; }
  .rpage .h1y{ font-size:30px; font-weight:800; letter-spacing:-.01em; margin:0; display:inline-block; padding-bottom:7px; border-bottom:4px solid var(--y); line-height:1; }
  .rpage .sub{ font-size:12.5px; font-weight:600; color:var(--muted); margin:12px 0 0; }
  .rpage .summary{ font-size:12.5px; font-weight:500; color:var(--ink-2); line-height:1.62; margin:13px 0 0; max-width:7.0in; }
  .rpage .summary b{ font-weight:800; color:var(--ink); }
  .rpage .block{ margin-top:20px; border:1.5px solid var(--ink); }
  .rpage .kpi-row{ display:flex; align-items:stretch; }
  .rpage .kpi-cell{ flex:1; padding:15px 18px 16px; text-align:center; }
  .rpage .kpi-cell + .kpi-cell{ border-left:1px solid var(--line); }
  .rpage .kpi-label{ font-size:9.5px; font-weight:700; letter-spacing:.11em; text-transform:uppercase; color:var(--muted); margin:0; min-height:24px; line-height:1.25; }
  .rpage .kpi-value{ font-size:28px; font-weight:800; letter-spacing:-.02em; margin:6px 0 0; line-height:1; }
  .rpage .kpi-foot{ margin-top:9px; }

  /* ============================ COVER ============================ */
  .cover .banner{ display:block; width:8.5in; height:auto; }
  .cover .watermark{ position:absolute; right:-0.85in; top:3.3in; width:5.2in; height:auto; opacity:.08; z-index:0; pointer-events:none; }
  .cover .body{ position:relative; z-index:1; padding:0.92in 0.75in 0; }
  .cover .eyebrow{ font-size:12px; font-weight:700; letter-spacing:.30em; text-transform:uppercase; color:var(--muted); margin:0; }
  .cover .identity{ display:flex; align-items:center; gap:20px; margin-top:24px; }
  .cover .identity .tile{ width:66px; height:66px; border-radius:16px; background:var(--ink); display:flex; align-items:center; justify-content:center; padding:10px; flex-shrink:0; overflow:hidden; }
  .cover .identity .tile img{ width:100%; height:100%; object-fit:contain; }
  .cover .identity .tile.initial{ color:var(--y); font-size:30px; font-weight:800; }
  .cover .title{ font-size:46px; font-weight:800; line-height:1.02; letter-spacing:-.02em; margin:0; display:inline-block; padding-bottom:14px; border-bottom:6px solid var(--y); }
  .cover .period{ font-size:22px; font-weight:600; color:var(--ink-2); margin:26px 0 5px; }
  .cover .compare{ font-size:13.5px; font-weight:500; color:var(--muted); margin:0; }
  .cover .toc{ margin-top:52px; max-width:5.4in; }
  .cover .toc-h{ font-size:11px; font-weight:700; letter-spacing:.20em; text-transform:uppercase; color:var(--muted); margin:0 0 6px; }
  .cover .toc-item{ display:flex; align-items:center; gap:15px; padding:15px 0; border-bottom:1px solid var(--line); }
  .cover .toc-item.first{ border-top:1px solid var(--line); }
  .cover .toc-dot{ width:36px; height:36px; border-radius:10px; background:var(--ink); color:var(--y); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .cover .toc-dot svg{ width:19px; height:19px; }
  .cover .toc-name{ font-size:16px; font-weight:700; color:var(--ink); }
  .cover .toc-desc{ font-size:11.5px; font-weight:500; color:var(--muted); margin-top:2px; }
  .cover .toc-pg{ margin-left:auto; font-size:11px; font-weight:600; color:var(--muted-2); letter-spacing:.05em; }
  .cover .prepared{ margin-top:46px; font-size:12.5px; color:var(--muted); line-height:1.75; }
  .cover .prepared b{ color:var(--ink); font-weight:700; }

  /* ============================ ADS ============================ */
  .ads .eq-row{ display:flex; align-items:stretch; }
  .ads .eq-cell{ flex:1; padding:17px 20px 18px; position:relative; text-align:center; }
  .ads .eq-cell + .eq-cell{ border-left:1px solid var(--line); }
  .ads .eq-op{ position:absolute; top:50%; right:-13px; transform:translateY(-50%); z-index:2; width:26px; height:26px; background:#fff; border:1px solid var(--line); display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:700; color:var(--muted); }
  .ads .eq-label{ font-size:10px; font-weight:700; letter-spacing:.13em; text-transform:uppercase; color:var(--muted); margin:0; }
  .ads .eq-value{ font-size:38px; font-weight:800; letter-spacing:-.025em; margin:8px 0 0; line-height:1; }
  .ads .eq-cell.punch .eq-value{ color:var(--y-dark); }
  .ads .eq-cell.punch .eq-value .x{ color:var(--y-dark); }
  .ads .eq-foot{ margin-top:11px; display:flex; align-items:center; justify-content:center; gap:7px; }
  .ads .eq-cell.punch::after{ content:""; position:absolute; left:0; right:0; bottom:0; height:5px; background:var(--y); }
  .ads .mid-rule{ height:1.5px; background:var(--ink); }
  .ads .funnel-head{ margin-top:26px; display:flex; align-items:baseline; gap:12px; }
  .ads .funnel-title{ font-size:14px; font-weight:800; letter-spacing:-.01em; margin:0; }
  .ads .funnel-sub{ font-size:10.5px; font-weight:500; color:var(--muted); margin:0; }
  .ads .funnel-zone{ position:relative; margin-top:18px; }
  .ads .conv-track{ position:relative; height:0.32in; }
  .ads .conv-track::before{ content:""; position:absolute; left:1.5%; right:1.5%; top:50%; transform:translateY(-50%); height:1px; background:var(--line); }
  .ads .conv-track .cm{ position:absolute; top:50%; transform:translate(-50%,-50%); display:inline-flex; align-items:center; gap:6px; background:#fff; padding:0 10px; white-space:nowrap; }
  .ads .conv-track .cm .arw{ font-size:9px; color:var(--y-dark); line-height:1; }
  .ads .conv-track .cm .pct{ font-size:13px; font-weight:800; color:var(--ink); line-height:1; }
  .ads .conv-track .cm .of{ font-size:8.5px; font-weight:600; color:var(--muted-2); text-transform:uppercase; letter-spacing:.05em; line-height:1; }
  .ads .chev-wrap{ margin-top:2px; display:flex; align-items:center; justify-content:center; height:1.46in; }
  .ads .chev{ position:relative; flex:1; height:100%; }
  .ads .chev .body{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:0 8px; color:#fff; text-align:center; }
  .ads .chev .label{ font-size:9.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; margin:0 0 5px; opacity:.82; max-width:1.15in; line-height:1.18; }
  .ads .chev .count{ font-size:32px; font-weight:800; letter-spacing:-.02em; line-height:1; }
  .ads .chev .ofpct{ font-size:9px; font-weight:600; margin-top:6px; opacity:.72; letter-spacing:.02em; }
  .ads .chev.c1 .body{ background:var(--ink);   clip-path:polygon(0 2%, 86% 2%, 100% 50%, 86% 98%, 0 98%); }
  .ads .chev.c2 .body{ background:var(--ink-2); clip-path:polygon(0 9%, 86% 9%, 100% 50%, 86% 91%, 0 91%, 14% 50%); }
  .ads .chev.c3 .body{ background:#4a4a52;      clip-path:polygon(0 16%, 86% 16%, 100% 50%, 86% 84%, 0 84%, 14% 50%); }
  .ads .chev.c4 .body{ background:var(--y);     clip-path:polygon(0 23%, 100% 23%, 100% 77%, 0 77%, 14% 50%); color:var(--ink); }
  .ads .chev.c4 .body .label{ opacity:.66; }
  .ads .chev.c4 .body .ofpct{ opacity:.66; }
  .ads .chev + .chev{ margin-left:-0.18in; }
  .ads .funnel-foot{ margin-top:15px; display:flex; justify-content:space-between; align-items:baseline; border-top:1px solid var(--line); padding-top:9px; }
  .ads .funnel-foot .ff-item{ font-size:9.5px; font-weight:500; color:var(--muted); white-space:nowrap; }
  .ads .funnel-foot .ff-item b{ color:var(--ink); font-weight:700; }

  /* ============================ SOCIAL ============================ */
  .social .kpi-cell{ padding:15px 10px 16px; }
  .social .kpi-label{ font-size:9px; letter-spacing:.08em; }
  .social .kpi-value{ font-size:24px; }
  .social .sec-head{ font-size:14px; font-weight:800; color:var(--ink); letter-spacing:-.01em; margin:30px 0 0; padding-bottom:9px; border-bottom:1px solid var(--ink); }
  .social .ptable{ width:100%; border-collapse:collapse; margin-top:2px; }
  .social .ptable thead th{ font-size:9px; font-weight:700; letter-spacing:.10em; text-transform:uppercase; color:var(--muted); padding:11px 0 9px; border-bottom:1px solid var(--line); text-align:right; white-space:nowrap; }
  .social .ptable thead th.lead{ text-align:left; }
  .social .ptable tbody td{ font-size:12.5px; padding:11px 0; border-bottom:1px solid var(--line); text-align:right; color:var(--ink-2); font-weight:700; vertical-align:middle; }
  .social .ptable tbody tr:last-child td{ border-bottom:none; }
  .social .ptable td.plat{ text-align:left; font-weight:700; color:var(--ink); }
  .social .ptable td.plat span{ display:inline-flex; align-items:center; gap:9px; }
  .social .ptable td.plat img{ width:17px; height:17px; object-fit:contain; }
  .social .ptable td.na{ color:var(--muted-2); font-weight:600; }
  .social .tc-wrap{ display:grid; grid-template-columns:1fr 1fr; gap:34px; margin-top:4px; }
  .social .tc-wrap > div{ min-width:0; }
  .social .tc-h{ font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); margin:0 0 4px; }
  .social .tc-row{ display:flex; align-items:baseline; gap:10px; padding:11px 0; border-bottom:1px solid var(--line); }
  .social .tc-row:last-child{ border-bottom:none; }
  .social .tc-rank{ font-size:12px; font-weight:800; color:var(--y-dark); width:14px; flex:0 0 auto; }
  .social .tc-main{ flex:1 1 auto; min-width:0; }
  .social .tc-tag{ font-size:8.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--muted-2); }
  .social .tc-cap{ font-size:11.5px; font-weight:600; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
  .social .tc-metric{ flex:0 0 auto; font-size:11.5px; font-weight:800; color:var(--ink); white-space:nowrap; }

  /* ============================ WEB & SEO ============================ */
  .seo .block{ margin-top:8px; }
  .seo .kpi-cell{ padding:13px 10px 14px; }
  .seo .kpi-label{ font-size:9px; letter-spacing:.08em; min-height:22px; }
  .seo .kpi-value{ font-size:24px; }
  .seo .kpi-foot{ margin-top:8px; }
  .seo .sec-head{ font-size:13px; font-weight:800; color:var(--ink); letter-spacing:.01em; margin:22px 0 0; text-transform:uppercase; }
  .seo .sec-head.tight{ margin-top:18px; }
  .seo .cols2{ display:grid; grid-template-columns:1fr 1fr; gap:34px; margin-top:6px; }
  .seo .stable{ width:100%; border-collapse:collapse; }
  .seo .stable .th{ font-size:8.5px; font-weight:700; letter-spacing:.10em; text-transform:uppercase; color:var(--muted); padding:9px 0 8px; border-bottom:1px solid var(--ink); }
  .seo .stable .th.r{ text-align:right; }
  .seo .stable td{ font-size:11.5px; padding:9px 0; border-bottom:1px solid var(--line); color:var(--ink-2); font-weight:600; }
  .seo .stable tr:last-child td{ border-bottom:none; }
  .seo .stable td.q{ color:var(--ink); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:1.9in; }
  .seo .stable td.r{ text-align:right; font-weight:800; color:var(--ink); }
  .seo .ts-wrap{ display:flex; align-items:center; gap:30px; margin-top:8px; }
  .seo .donut{ position:relative; width:1.5in; height:1.5in; flex:0 0 auto; }
  .seo .donut .ctr{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .seo .donut .ctr .n{ font-size:20px; font-weight:800; line-height:1; }
  .seo .donut .ctr .l{ font-size:8px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin-top:3px; }
  .seo .legend{ flex:1 1 auto; display:grid; grid-template-columns:1fr 1fr; gap:5px 26px; }
  .seo .lrow{ display:flex; align-items:center; gap:9px; padding:5px 0; border-bottom:1px solid var(--soft); }
  .seo .lsw{ width:11px; height:11px; border-radius:3px; flex:0 0 auto; }
  .seo .lname{ font-size:11px; font-weight:600; color:var(--ink-2); }
  .seo .lval{ margin-left:auto; font-size:11px; font-weight:800; color:var(--ink); }
  .seo .lval .pct{ font-size:9.5px; font-weight:600; color:var(--muted); margin-left:5px; }

  /* ============================ LOCAL MAP ============================ */
  .local .localwrap{ display:flex; gap:28px; margin-top:18px; align-items:flex-start; }
  .local .rmap{ width:410px; height:360px; border-radius:14px; border:1px solid var(--line); overflow:hidden; flex:0 0 auto; background:#eef0f2; }
  .leaflet-container{ font-family:'Montserrat',sans-serif; background:#eef0f2; }
  .pin{ border-radius:50%; color:#fff; font-weight:800; display:flex; align-items:center; justify-content:center; border:2px solid #fff; }
  .local .localstats{ flex:1 1 auto; padding-top:4px; }
  .local .avg-label{ font-size:10px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin:0; }
  .local .avg-num{ font-size:62px; font-weight:800; letter-spacing:-.03em; line-height:.95; margin:6px 0 0; }
  .local .avg-sub{ font-size:11px; font-weight:500; color:var(--muted); margin:6px 0 0; }
  .local .bands{ margin-top:24px; }
  .local .brow{ display:flex; align-items:center; gap:11px; padding:10px 0; border-bottom:1px solid var(--line); }
  .local .brow:last-child{ border-bottom:none; }
  .local .bdot{ width:13px; height:13px; border-radius:50%; flex:0 0 auto; }
  .local .bname{ font-size:12px; font-weight:700; color:var(--ink-2); }
  .local .bcount{ margin-left:auto; font-size:12px; font-weight:800; color:var(--ink); }
  .local .bcount span{ font-weight:600; color:var(--muted); font-size:10.5px; margin-left:3px; }
  .local .sec-head{ font-size:13px; font-weight:800; color:var(--ink); letter-spacing:.01em; margin:26px 0 0; text-transform:uppercase; }
  .local .ctable{ width:100%; border-collapse:collapse; margin-top:6px; }
  .local .ctable .th{ font-size:8.5px; font-weight:700; letter-spacing:.10em; text-transform:uppercase; color:var(--muted); padding:9px 10px 8px; border-bottom:1px solid var(--ink); }
  .local .ctable .th.r{ text-align:right; }
  .local .ctable td{ font-size:12px; padding:10px; border-bottom:1px solid var(--line); color:var(--ink-2); font-weight:600; }
  .local .ctable tr:last-child td{ border-bottom:none; }
  .local .ctable td.rank{ font-weight:800; color:var(--ink); width:42px; }
  .local .ctable td.biz{ font-weight:700; color:var(--ink); }
  .local .ctable td.r{ text-align:right; font-weight:800; color:var(--ink); }
  .local .ctable tr.you td{ background:#FFF7D1; }
  .local .ctable .star{ color:var(--y-dark); }
  .local .mapnote{ font-size:9px; font-weight:500; color:var(--muted-2); margin-top:8px; }
`;
