# Benchmark summary

ms per operation; per-round results as best–worst; speed-up = base best / head best.

## Editor (Bun / JavaScriptCore; each round is the best of 5 batches)

| scenario · chars | base | head | speed-up |
|---|---:|---:|---:|
| cursor-move · 20,000 | 3.02–4.02 | 0.599–0.793 | 5.1× |
| cursor-move · 100,000 | 14.34–21.54 | 1.73–2.08 | 8.3× |
| cursor-move · 300,000 | 45.51–74.83 | 3.98–6.60 | 11.4× |
| keystroke · 20,000 | 4.13–4.42 | 1.03–1.46 | 4.0× |
| keystroke · 100,000 | 25.38–26.55 | 2.56–3.86 | 9.9× |
| keystroke · 300,000 | 59.74–92.02 | 8.73–12.38 | 6.8× |
| parse-only-keystroke · 20,000 | 0.345–0.471 | 0.278–0.354 | 1.2× |
| parse-only-keystroke · 100,000 | 0.505–0.995 | 0.978–2.45 | 0.5× |
| parse-only-keystroke · 300,000 | 2.27–4.60 | 1.54–4.60 | 1.5× |
| word-count-per-keystroke · 100,000 | 0.996–1.15 | — | — |
| word-count-per-keystroke · 1,000,000 | 10.01–17.59 | — | — |
| word-count-per-pause · 100,000 | — | 2.90–2.97 | — |
| word-count-per-pause · 1,000,000 | — | 31.43–33.99 | — |

## Preview render (Chrome; each round is the best of 5 batches)

| scenario · chars | base | head | speed-up |
|---|---:|---:|---:|
| render-html-every-section · 20,000 | 3.17–4.27 | 16.64–17.85 | 0.2× |
| render-html-every-section · 100,000 | 19.99–21.81 | 85.04–85.46 | 0.2× |
| render-markdown · 20,000 | 4.30–4.97 | 5.10–5.65 | 0.8× |
| render-markdown · 100,000 | 22.90–26.30 | 26.43–26.94 | 0.9× |
| render-readme-html-header · 20,000 | 4.37–5.21 | 18.08–19.83 | 0.2× |
| render-readme-html-header · 100,000 | 21.51–27.15 | 95.64–107 | 0.2× |

## Storage (Go; 3 runs × 20 iterations per round)

| benchmark | base | head | speed-up |
|---|---:|---:|---:|
| CursorMove2MB | 24.39–58.63 | 3.06–5.99 | 8.0× |
| IdlePoll | 65.17–97.93 | 0.002–0.004 | 41,723× |
| RecentList | 62.86–113 | 0.036–0.200 | 1,729× |
| SaveFile2MB | 90.47–225 | 66.41–99.55 | 1.4× |
| SaveSmallDraft | 7.25–22.76 | 7.60–20.08 | 1.0× |
| Startup300Drafts | 341–1464 | 295–711 | 1.2× |
