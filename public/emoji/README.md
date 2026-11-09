# Hush emojis — Twemoji pack (60)

The whole site uses these 60 emojis — never Unicode/global emojis.
They are the **Twemoji** pack (jdecked fork), **CC-BY 4.0** — attribution
is required and lives in [`ATTRIBUTION.md`](./ATTRIBUTION.md) plus the
visible credits on the site (landing footer + join gates).

- Source pack: `new emoji/hush_emoji_pro/` (gitignored, local only),
  built by `new emoji/emoji_forge.py` (`--source twemoji`).
- This folder is a copy of that pack: `*.svg` (runtime, 64×64),
  `png/*.png` (512px), `preview.png`, `manifest.json`, `ids.json`.
- In chat: type a shortcode like `:laugh:` or pick from the smile button.
- On the soundboard: each sound shows its own emoji.
- Reactions & floating reactions: custom emoji ids, server-validated.
- Regenerate: `pip install requests pillow tqdm` then
  `python emoji_forge.py --source twemoji --out hush_emoji_pro`,
  then copy `*.svg` (+ `png/`, `preview.png`, `manifest.json`,
  `ids.json`, `ATTRIBUTION.md`) over this folder.
- Add a new one: run the forge with `--add <id>=<unicode-hex>`, copy the
  new files here, and add the id to `CUSTOM_EMOJI_IDS` in
  `src/constants.js` and `CUSTOM_EMOJIS` in `public/js/emoji.js`.
