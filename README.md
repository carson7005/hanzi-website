# Hanzi Drill

Draw the hanzi for an English prompt; each stroke is checked as you draw.

## Deploy on GitHub Pages
1. Create a repo (e.g. `hanzi-drill`) and upload everything in this folder (keep `vendor/`).
2. Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main` / `(root)`.
3. Open `https://<your-username>.github.io/hanzi-drill/`.

## Adding vocab lists for everyone (permanent)
Put each list as a `.docx` in the repo's `lists/` folder (GitHub: open `lists/` → **Add file → Upload files** → Commit).
On github.io the site auto-detects every `.docx` in that folder, so nothing else is needed (the name comes from the filename,
underscores become spaces). `lists/manifest.json` is an optional fallback/rename list: `{"file": "L4_Food.docx", "name": "L4 Food"}`.
The page itself has no upload button; the repo's `lists/` folder is the only source of vocab.

## Where progress lives
There are no accounts. Your progress and settings are saved in this browser (localStorage) on this device.
**Export** downloads a backup `.json`; **Import** restores it (e.g. on another device). Clearing site data erases progress.

## Files
- `index.html`, `style.css`, `app.js` – the app
- `data.js` – built-in L3 list (added to every new profile)
- `vendor/` – Hanzi Writer + JSZip (MIT). Stroke data is fetched per character from the jsDelivr CDN.
