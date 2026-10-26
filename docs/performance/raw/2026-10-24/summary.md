# Benchmark summary

ms per operation; per-round results as best–worst; speed-up = base best / head best.

## Editor (Bun / JavaScriptCore; each round is the best of 5 batches)

| scenario · chars | base | head | speed-up |
|---|---:|---:|---:|
| cursor-move · 20,000 | 0.577–0.643 | 0.659–0.764 | 0.9× |
| cursor-move · 100,000 | 1.94–2.79 | 1.50–2.15 | 1.3× |
| cursor-move · 300,000 | 6.82–8.35 | 4.98–5.60 | 1.4× |
| cursor-move-rich · 20,000 | 0.404–0.462 | 1.39–1.49 | 0.3× |
| cursor-move-rich · 100,000 | 1.24–1.79 | 4.86–6.09 | 0.3× |
| cursor-move-rich · 300,000 | 4.89–5.37 | 19.48–22.09 | 0.3× |
| keystroke · 20,000 | 1.13–1.98 | 0.857–0.982 | 1.3× |
| keystroke · 100,000 | 3.14–4.19 | 1.72–3.21 | 1.8× |
| keystroke · 300,000 | 11.00–15.32 | 9.61–13.17 | 1.1× |
| keystroke-rich · 20,000 | 0.704–0.776 | 1.23–2.69 | 0.6× |
| keystroke-rich · 100,000 | 2.39–3.31 | 6.07–6.84 | 0.4× |
| keystroke-rich · 300,000 | 8.04–14.55 | 16.03–18.33 | 0.5× |
| parse-only-keystroke · 20,000 | 0.287–0.384 | 0.270–0.720 | 1.1× |
| parse-only-keystroke · 100,000 | 0.920–1.87 | 0.871–1.93 | 1.1× |
| parse-only-keystroke · 300,000 | 3.81–4.91 | 3.85–5.45 | 1.0× |
| parse-only-keystroke-rich · 20,000 | 0.227–0.256 | 0.238–0.270 | 1.0× |
| parse-only-keystroke-rich · 100,000 | 0.892–1.25 | 0.888–1.25 | 1.0× |
| parse-only-keystroke-rich · 300,000 | 2.40–3.46 | 2.66–3.16 | 0.9× |
| word-count-per-pause · 100,000 | 3.11–3.88 | 2.83–3.15 | 1.1× |
| word-count-per-pause · 1,000,000 | 28.79–33.67 | 29.35–33.08 | 1.0× |

## Preview render (Chrome; each round is the best of 5 batches)

| scenario · chars | base | head | speed-up |
|---|---:|---:|---:|
| render-html-every-section · 20,000 | 13.78–14.74 | 14.13–17.78 | 1.0× |
| render-html-every-section · 100,000 | 72.09–78.32 | 70.51–73.76 | 1.0× |
| render-markdown · 20,000 | 5.06–6.03 | 5.49–5.97 | 0.9× |
| render-markdown · 100,000 | 27.33–29.45 | 26.09–28.83 | 1.0× |
| render-readme-html-header · 20,000 | 16.69–18.34 | 18.15–19.40 | 0.9× |
| render-readme-html-header · 100,000 | 84.73–93.06 | 87.79–97.28 | 1.0× |
| render-rich-notes · 20,000 | 3.92–4.05 | 7.81–9.63 | 0.5× |
| render-rich-notes · 100,000 | 23.15–26.01 | 78.88–82.70 | 0.3× |

## Storage (Go; 3 runs × 20 iterations per round)

| benchmark | base | head | speed-up |
|---|---:|---:|---:|
| CursorMove2MB | 3.02–3.77 | 2.81–4.60 | 1.1× |
| IdlePoll | 0.001–0.006 | 0.001–0.007 | 1.0× |
| RecentList | 0.483–1.13 | 0.498–1.31 | 1.0× |
| SaveFile2MB | 60.28–74.29 | 64.93–73.10 | 0.9× |
| SaveSmallDraft | 8.75–10.68 | 6.94–12.45 | 1.3× |
| Startup300Drafts | 313–448 | 331–569 | 0.9× |

## Editing in WebKit (off-screen WKWebView; per round: median of 3 opens, of 60 keystrokes or arrow keys, of 40 scroll steps; memory in MB)

| scenario · chars | base | head | speed-up |
|---|---:|---:|---:|
| arrow-latency · 20,000 | 6.00–8.00 | 5.00–7.00 | 1.2× |
| arrow-latency · 100,000 | 8.00–11.00 | 9.00–10.00 | 0.9× |
| arrow-latency · 300,000 | 12.00–13.00 | 10.00–12.00 | 1.2× |
| arrow-latency-rich · 100,000 | 6.00–10.00 | 11.00–12.00 | 0.5× |
| arrow-work · 20,000 | 6.00–8.00 | 5.00–7.00 | 1.2× |
| arrow-work · 100,000 | 8.00–11.00 | 8.00–10.00 | 1.0× |
| arrow-work · 300,000 | 12.00–13.00 | 10.00–11.00 | 1.2× |
| arrow-work-p95 · 20,000 | 10.00–48.00 | 10.00–19.00 | 1.0× |
| arrow-work-p95 · 100,000 | 13.00–15.00 | 13.00–31.00 | 1.0× |
| arrow-work-p95 · 300,000 | 18.00–30.00 | 16.00–17.00 | 1.1× |
| arrow-work-p95-rich · 100,000 | 11.00–12.00 | 15.00–30.00 | 0.7× |
| arrow-work-rich · 100,000 | 6.00–10.00 | 11.00 | 0.5× |
| idle-frame-interval · 0 | 17.00 | 17.00 | 1.0× |
| keystroke-latency · 20,000 | 7.00–8.00 | 7.00–10.00 | 1.0× |
| keystroke-latency · 100,000 | 11.00–13.00 | 10.00–12.00 | 1.1× |
| keystroke-latency · 300,000 | 19.00–23.00 | 18.00–23.00 | 1.1× |
| keystroke-latency-p95 · 20,000 | 13.00–24.00 | 14.00–16.00 | 0.9× |
| keystroke-latency-p95 · 100,000 | 15.00–27.00 | 14.00–27.00 | 1.1× |
| keystroke-latency-p95 · 300,000 | 26.00–34.00 | 24.00–36.00 | 1.1× |
| keystroke-latency-p95-rich · 100,000 | 15.00–26.00 | 17.00–24.00 | 0.9× |
| keystroke-latency-rich · 100,000 | 10.00 | 13.00–15.00 | 0.8× |
| keystroke-sync · 20,000 | 4.00–5.00 | 5.00–8.00 | 0.8× |
| keystroke-sync · 100,000 | 9.00–10.00 | 8.00–9.00 | 1.1× |
| keystroke-sync · 300,000 | 17.00–20.00 | 16.00–20.00 | 1.1× |
| keystroke-sync-rich · 100,000 | 8.00 | 10.00–11.00 | 0.8× |
| keystroke-work · 20,000 | 7.00–8.00 | 7.00–10.00 | 1.0× |
| keystroke-work · 100,000 | 11.00–13.00 | 10.00–12.00 | 1.1× |
| keystroke-work · 300,000 | 19.00–23.00 | 18.00–23.00 | 1.1× |
| keystroke-work-p95 · 20,000 | 13.00–21.00 | 14.00–16.00 | 0.9× |
| keystroke-work-p95 · 100,000 | 15.00–24.00 | 14.00–24.00 | 1.1× |
| keystroke-work-p95 · 300,000 | 25.00–33.00 | 22.00–36.00 | 1.1× |
| keystroke-work-p95-rich · 100,000 | 15.00–26.00 | 17.00–19.00 | 0.9× |
| keystroke-work-rich · 100,000 | 10.00 | 13.00–14.00 | 0.8× |
| memory-mb · 20,000 | 136–150 | 142–169 | 1.0× |
| memory-mb · 100,000 | 167–176 | 184–188 | 0.9× |
| memory-mb · 300,000 | 167–174 | 120–197 | 1.4× |
| memory-mb-after-editing · 20,000 | 153–190 | 179–185 | 0.9× |
| memory-mb-after-editing · 100,000 | 177–222 | 191–250 | 0.9× |
| memory-mb-after-editing · 300,000 | 190–197 | 209–259 | 0.9× |
| memory-mb-after-editing-rich · 100,000 | 237–252 | 304–370 | 0.8× |
| memory-mb-rich · 100,000 | 149–181 | 262–349 | 0.6× |
| open · 20,000 | 96.00–123 | 106–145 | 0.9× |
| open · 100,000 | 91.00–169 | 112–168 | 0.8× |
| open · 300,000 | 113–219 | 117–280 | 1.0× |
| open-hitch · 20,000 | 25.00–38.00 | 26.00–36.00 | 1.0× |
| open-hitch · 100,000 | 48.00–54.00 | 53.00–62.00 | 0.9× |
| open-hitch · 300,000 | 54.00–87.00 | 42.00–57.00 | 1.3× |
| open-hitch-rich · 100,000 | 47.00–76.00 | 57.00–68.00 | 0.8× |
| open-rich · 100,000 | 100–165 | 303–479 | 0.3× |
| pause-hitch · 20,000 | 18.00–26.00 | 23.00–37.00 | 0.8× |
| pause-hitch · 100,000 | 18.00–26.00 | 33.00–37.00 | 0.5× |
| pause-hitch · 300,000 | 20.00–137 | 42.00–68.00 | 0.5× |
| pause-hitch-rich · 100,000 | 21.00–24.00 | 21.00–39.00 | 1.0× |
| scroll-latency · 20,000 | 16.00–21.00 | 10.00–12.00 | 1.6× |
| scroll-latency · 100,000 | 18.00–19.00 | 13.00–14.00 | 1.4× |
| scroll-latency · 300,000 | 16.00–17.00 | 13.00–14.00 | 1.2× |
| scroll-latency-rich · 100,000 | 9.00–13.00 | 11.00–16.00 | 0.8× |
| scroll-work · 20,000 | 4.00–10.00 | 5.00–8.00 | 0.8× |
| scroll-work · 100,000 | 5.00–6.00 | 5.00–7.00 | 1.0× |
| scroll-work · 300,000 | 6.00–7.00 | 6.00 | 1.0× |
| scroll-work-p95 · 20,000 | 6.00–36.00 | 9.00–14.00 | 0.7× |
| scroll-work-p95 · 100,000 | 11.00–33.00 | 7.00–17.00 | 1.6× |
| scroll-work-p95 · 300,000 | 9.00–19.00 | 7.00–18.00 | 1.3× |
| scroll-work-p95-rich · 100,000 | 8.00–9.00 | 24.00–32.00 | 0.3× |
| scroll-work-rich · 100,000 | 4.00–5.00 | 7.00–10.00 | 0.6× |

## Web bundle (committed web/)

| file | base | head |
|---|---:|---:|
| app.js | 1,902 KB (656 KB gzip) | 2,289 KB (769 KB gzip) |
| style.css | 28 KB (6 KB gzip) | 61 KB (12 KB gzip) |
| boot.js | 0 KB (0 KB gzip) | 2 KB (1 KB gzip) |
| lazy chunks | 0 KB (0 KB gzip) | 5,552 KB (1,573 KB gzip) |
| fonts | 0 KB (0 KB gzip) | 254 KB (254 KB gzip) |
| web/ total | 2,129 KB | 8,544 KB |
