# Chinese Practice

Draw the hanzi for an English prompt; each stroke is checked as you draw.

## Deploy on GitHub Pages
1. Create a repo (e.g. `hanzi-drill`) and upload everything in this folder (keep `vendor/`).
2. Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main` / `(root)`.
3. Open `https://<your-username>.github.io/hanzi-drill/`.

## Adding vocab lists for everyone (permanent)
Put each list as a `.docx` in the repo's `lists/` folder (GitHub: open `lists/` → **Add file → Upload files** → Commit).
On github.io the site auto-detects every `.docx` in that folder, so nothing else is needed (the name comes from the filename,
underscores become spaces). `lists/manifest.json` must also list every file: it's used when GitHub's file-listing limit (60 requests/hour per network) runs out, e.g. on school Wi-Fi. It also sets display names: `{"file": "L4_Food.docx", "name": "L4 Food"}`.
The page itself has no upload button; the repo's `lists/` folder is the only source of vocab.

## Where progress lives
Progress is saved in the browser as you go. Press **☁️ Sign in to sync** and sign in with Google to keep it in the cloud
(Firebase, free Spark plan): it syncs automatically a few seconds after each answer and when you come back to the page,
so any signed-in device picks up where you left off. Syncing merges, keeping the newest result per word.
**Reset progress** while signed in clears it everywhere. Firebase settings live in `firebase-config.js`.

## Practice types (tabs on the home screen)
- **✍️ Writing**: draw each hanzi stroke by stroke from its English meaning. Press **📖 Learn** on a word you don't know yet
  for a guided Watch → Trace → Copy lesson, then draw it from memory (counts as needing review).
- **🔤 Pinyin**: see the hanzi, type its full pinyin with tone numbers (`ni3 hao3`) or marks (`nǐ hǎo`). New words get a
  study card if you press **📖 Learn** (counts as needing review). Wrong answers say which syllable is off (spelling or tone), and missed words come back later in the round.
- **🌐 Translate**: translate sentences English → Chinese, Chinese → English, or both. Exact matches (ignoring punctuation,
  capitals, a/the, contractions) are marked right; otherwise you see the differences and judge it yourself.
  Sentences live in `sentences.js` under the lesson number (`L1`, `L2`, …, matched from the list name). A list with no
  sentences there uses its own example phrases instead.

- **🎧 Listen**: the word is spoken (browser speech); answer by typing its pinyin or writing the characters.
  "Show meaning" is free, since some words sound alike.

Pinyin is coloured by tone everywhere (1 red · 2 orange · 3 green · 4 blue · neutral grey), and 🔊 plays the word.
Each practice type has its own progress.

## Files
- `index.html`, `style.css` – the page
- `js/` – the app, one file per area (core, lists, home, session, write, pinyin-drill, translate, main)
- `sentences.js` – translation sentences per lesson
- `cloud.js`, `firebase-config.js` – optional cloud sync
- `pinyin.js` – splits pinyin into syllables and checks answers
- `data.js` – built-in L3 list (added to every new profile)
- `vendor/` – Hanzi Writer + JSZip (MIT). Stroke data is fetched per character from the jsDelivr CDN.
