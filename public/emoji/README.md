# Hush custom emojis

60 hand-made SVG emojis, only for Hush. The whole site uses these —
never Unicode/global emojis.

- In chat: type a shortcode like `:laugh:` or pick from the smile button.
- On the soundboard: each sound shows its own emoji.
- Reactions & floating reactions: custom emoji ids, server-validated.
- Add a new one: drop `<id>.svg` here (64×64 viewBox), add the id to
  `CUSTOM_EMOJI_IDS` in `src/constants.js` and `CUSTOM_EMOJIS` in
  `public/js/emoji.js`.
