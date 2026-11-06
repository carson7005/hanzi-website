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
There are no accounts. Progress and settings are saved in this browser (localStorage) on this device.
**💾 Save / load** gives you a *progress link*: copy it (or share it) and keep it in your notes or email. Opening the link
on any device loads your progress. You can also paste the link/code, or use a downloaded backup file. Loading always
combines with what's there (newest result per word wins). The home screen reminds you when there's unsaved progress.

## Practice types
- **✍️ Write characters**: draw each hanzi stroke by stroke.
- **🔤 Pinyin & tones**: see the hanzi, type its pinyin with tone numbers (`ni3 hao3`) or marks (`nǐ hǎo`). New words get a
  study card first. Wrong answers say which syllable is off (spelling or tone), and missed words come back later in the round.
  Pinyin is coloured by tone everywhere (1 red · 2 orange · 3 green · 4 blue · neutral grey), and 🔊 plays the word.

## Files
- `index.html`, `style.css`, `app.js` – the app
- `pinyin.js` – splits pinyin into syllables and checks answers
- `data.js` – built-in L3 list (added to every new profile)
- `vendor/` – Hanzi Writer + JSZip (MIT). Stroke data is fetched per character from the jsDelivr CDN.
