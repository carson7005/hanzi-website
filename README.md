# Hanzi Drill

Draw the hanzi for an English prompt; each stroke is checked as you draw.

## Deploy on GitHub Pages
1. Create a repo (e.g. `hanzi-drill`) and upload everything in this folder (keep `vendor/`).
2. Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main` / `(root)`.
3. Open `https://<your-username>.github.io/hanzi-drill/`.

## Where data lives
GitHub Pages is static hosting, so there is no server to write files to. Profiles, uploaded vocab lists and
progress are saved in the browser (localStorage), per device. Use **Export** to download a `.json` backup and
**Import profile file** on the login screen to restore it or move it to another device.
Clearing site data in the browser erases local profiles, so export now and then.

## Files
- `index.html`, `style.css`, `app.js` – the app
- `data.js` – built-in L3 list (added to every new profile)
- `vendor/` – Hanzi Writer + JSZip (MIT). Stroke data is fetched per character from the jsDelivr CDN.
