# Hush

Quiet rooms for text, voice, video, and screen sharing — styled with the Signal-inspired design system in [`DESIGN.md`](./DESIGN.md).

No accounts, no build step. Open the page, pick a name, and share the room link.

## Developer

Built by **Zerouki Ahmed Mouad** (زروقي احمد معاذ).

- GitHub: <https://github.com/mouadkennedy2001>
- Instagram: <https://www.instagram.com/mouad_kennedy/>

## Features

- **Giphy search (v12) + GIF links** — the emoji picker GIF tab searches Giphy (search / Trending / Random) through the server proxy `/api/gif/*`; the API key lives **only** on the server (`GIPHY_API_KEY` env or gitignored `.env`, see `.env.example`) and never reaches browser code. Any direct https `.gif` link (Tenor / anywhere) still renders inline, with a clickable fallback if it fails to load. Fixed: CSP blocked all https images, so pasted GIFs showed a tiny broken icon (the `error/` screenshot). In v12.1 there are also **dedicated GIF + sticker buttons beside the chat box** (separate menus, rooms + servers), GIFs render up to 340px and stickers up to 128px alone / 56px inline, sticker filter tabs are translated (Arabic in Arabic, English in English), the join-gate **display-name box** has a user icon + 0/32 counter + hint (52px, glowing focus), and the **Log** has search + kind filters (All / Updates / Fixes / Security / Features) with cards that wrap without clipping in Arabic RTL.
- **65 unique stickers + custom sticker creator (v12)** — all 65 built-in stickers are now unique drawings with unique names (the old set repeated only 5 shapes in different colors; IDs are stable so old `:sticker-XX:` messages still render; regenerate with `node Sticker/generate.mjs`). **Create sticker**: pick PNG/JPG/GIF/WebP/AVIF (2 MB, SVG blocked) — it stays on this device in **IndexedDB** (localStorage fallback for small images, 30 stickers / 12 MB caps) until you press Send, then its Blob is uploaded from IndexedDB via the existing upload flow and sent as an image.
- **Emojis: Twemoji pack (v12.2)** — all 60 site emojis (`public/emoji/`) are the Twemoji pack (jdecked fork, CC-BY 4.0), built by `new emoji/emoji_forge.py` (`--source twemoji`) into `new emoji/hush_emoji_pro/` and copied into `public/emoji/` (SVG + PNG + preview + manifest + ids). Attribution: [`public/emoji/ATTRIBUTION.md`](./public/emoji/ATTRIBUTION.md) + visible credits on the landing footer and join gates. In v12.3 the emoji assets carry a cache-busting version (`?v=twemoji-1`, bump `EMOJI_ASSET_VERSION` in `public/js/emoji.js` on the next pack change) so a new pack shows immediately instead of being hidden by the browser's immutable cache, and the emojis render larger (picker 38px, inline 28px, emoji-only 48px).
- **Log (سجل) — bilingual** — a **Log** button (`Log` in English / `السجل` in Arabic) on the landing page and in the room opens a changelog dialog (`/api/changelog` ← `public/changelog.json`) with bilingual entries (`titleEn/titleAr`, `pointsEn/pointsAr`), newest first, plus a "new" dot until you open it. The dialog re-renders live when you switch language.
- **Admin / host, kick, ban, disconnect** — the first person in a room is the host (Admin). Right-click (mouse right button) any person in the People list or any video tile to open an admin menu: **Kick**, **Disconnect**, **Ban** (device + IP, default 60 min, persisted per room), **Make host**. Host transfer is automatic when the host leaves. Kicked/banned users see why and are disconnected immediately.
- **Anti multi-account (same device)** — each browser has a device id (`hush:device`). One device = one account per room: opening a second tab from the same device replaces the old session instead of flooding the room with clones. Bans match on hashed device + IP.
- **Anti-spam algorithms** — duplicate message detection (same text within 15s), burst limit (8 msgs / 10s), min interval (700ms), link flood (>3 links), emoji flood (>10), repeated-char flood, caps shouting — repeated spam gets a strike and a 30s mute penalty box. Bidi/zero-width tricks are stripped.
- **Better ping (v2)** — monotonic clock (`performance.now`), median filter, EWMA smoothing (α=0.3), outlier rejection (>3× median), adaptive polling (5s when good → 1.5s when offline), plus median display in the Connection card. Server: Socket.IO `pingInterval 8s / pingTimeout 12s`, WebSocket-first, smaller buffer.
- **Sounds (10)** — `public/sounds/` ships `message, mention, join, leave, error, kick, ban, success, click, blip` (WAV). Played via `public/js/sounds.js` with WebAudio fallback, volume slider + test button, saved in `hush:sounds` / `hush:sound-volume`. Joins/leaves/kicks/bans/mentions all have sounds.
- **Two SEPARATE systems — Rooms and Servers**
  - **Rooms (standalone)** — `/r/<code>`: quick rooms with a short code (open a room, join with a code). Nothing server-related appears here.
  - **Servers (permanent)** — `/s/<id>`: a completely separate system with its own page (`server.html`), its own chat storage (`data/server-chats/<id>/`), its own uploads (`uploads/server-<id>/`) and its own voice relay. Channels carry **no room codes**.
    - **Invite link to join** — every server has a permanent 6-char invite code. Copy the invite link (`/s/<id>?invite=CODE`) or paste the code into "Join with an invite code" on the landing page. Non-members without the code are rejected (403); the owner can regenerate it.
    - **Channels** — text + voice groups, add a channel (any member), delete a channel / delete the server (owner), leave the server, members list with owner badge, member count.
    - **Server chat** — saved per channel and permanent (survives restarts), edit/delete your own messages, emoji shortcodes, attach files, **paste images (Ctrl+V)**, in-page image lightbox (no new tab, call keeps running), soundboard relayed to the whole server.
    - **Server voice** — voice channels with mic/camera via WebRTC (MediaMesh), speaking tiles, presence.
- **Improved icons (no overlap)** — fixed-size `flex:none` icons, `minmax()` grids for the soundboard/emoji/reaction pickers, and cleaned-up emoji SVGs (`starstruck`, `flower`, `robot`, `alien`).
- **Images stay in the page (no new tab)** — clicking an image in chat opens an in-page lightbox with a close (exit) button, `Esc` and backdrop close, so viewing a photo never opens a new browser tab and never interrupts the voice/video call. Non-image files download directly.
- **Paste images (Ctrl+V)** — an image in your clipboard (including a screenshot) auto-uploads into the chat. Plain-text paste is untouched.
- **Custom site emojis (`public/emoji/`) — 60 total, the ONLY emojis on the site** — hand-made SVGs only for Hush (soundboard: `airhorn…tada` + `laser, siren, drumroll, yay`; faces: `smile, laugh, love, cool, think, sad, angry, party, sleep, mindblown, hush, wink, surprised, cry, kiss, dizzy, starstruck`; characters: `robot, ghost, alien`; hands: `wave, ok, thumbsup, thumbsdown, pray, strong, applause`; objects: `hundred, sparkles, glowstar, idea, book, coffee, pizza, ball, game, rocket, heart, fire, star, check, cross, eyes, music, flower`), loaded via `public/js/emoji.js`. Soundboard, chat picker, message reactions, floating reactions, and the landing page all show these images — **zero Unicode/global emojis** (a test scans every file under `public/`). In chat, emojis are shortcodes (`:laugh:`) rendered as images, including in search highlights; reactions store/reject by custom id (`thumbsup…check`), and the legacy `custom:<id>` floating form is normalized server-side. Richer look: soft drop-shadow, pop-in animation and hover motion.
- **Soundboard (16)** — a toolbar button (or `B`) opens a board of synthesized sounds (airhorn, rimshot, applause, sad trombone, boing, ding, pop, fart, meow, wow, crickets, ta-da, laser, siren, drumroll, yay) built with WebAudio oscillators + noise — no audio files, works offline. Each button shows its custom Hush emoji. Playing one relays it to the whole room (`soundboard:play`, server-validated + rate-limited). Volume slider saved in `hush:soundboard-volume`.
- **Custom room soundboard** — upload your own audio clip for the room (mp3/wav/ogg/m4a/webm, 2 MB max, 12 per room) with a name + custom emoji picker; it plays for everyone in that room only. Stored in `uploads/<code>/board/` + room metadata, synced via `soundboard:added`, deletable by its uploader or the host (`soundboard:deleteCustom`), clearable by the host (`soundboard:clearCustom`). **Deleted completely when the last person leaves the room** (files + metadata — `RoomManager.purgeCustomSounds` on last `leave()`, plus idle-cleanup/history-purge backstops), so a rejoining session starts with an empty custom board.
- **Per-person volume (right-click)** — right-click any person or video tile (anyone, not just the host) to open a volume menu: slider 0–200%, quick buttons (0/50/100/150/200%), mute, and reset. Above 100% uses a WebAudio `GainNode` per peer (an `<audio>` element caps at 100%). Adjusted volumes show as a badge on the tile/People row and persist per room + per person (`hush:volumes:<room>`) across reconnects. Hosts get their admin actions under the volume section.
- **Deafen (`D`)** — mute all remote audio for you only; nobody else is affected.
- **Ping (v4) + lower latency** — 2 probes/round (was 3 — less self-contention), best-of-2, min of last 4 rounds, 3s refresh when good, 1.5s timeout, paused while hidden, chart drawn only when visible. Server: `TCP_NODELAY` on every socket (removes Nagle's 40ms stall), Socket.IO heartbeat 5s/8s, JS/CSS served with ETag revalidation (304) and sounds immutable-cached, so reloads and joins fetch less.
- **Performance fixes** — WebRTC `disconnected` (transient) no longer tears the call down, only `failed` does; speaking-detection analysers are built once per stream, not per packet; presence bursts batch into one `requestAnimationFrame` render; notification sounds reuse one decoded `<audio>` per sound; global IP-ban/join counters are per-server and swept (no cross-instance leaks); client IP honors `X-Forwarded-For`; shortcuts are suppressed while any dialog is open; chat messages use `content-visibility`.
- **Stronger protection** — per-IP socket cap (20) and join cap (60/min), global HTTP rate limit, same-origin guard for API writes, double-extension upload block (`photo.jpg.exe`), CSP `object-src 'none'`, `Cross-Origin-Opener-Policy`, stricter `Permissions-Policy`.
- **Arabic and English** — full RTL/LTR support, Arabic typography, a language toggle on every page, and a saved language preference (`?lang=ar` / `?lang=en` also work).
- **Light, dark, and automatic themes** — the theme toggles between light → dark → auto (follows the OS and reacts to OS changes live), saved per browser (`hush:theme`). `?theme=dark` / `?theme=light` / `?theme=auto` also work. Press `T` in a room.
- **Pinned messages** — pin any message to the top of chat (pin icon on hover), jump to it from the pinned bar, unpin it, and it persists across reloads and syncs to everyone.
- **Emoji picker** — insert emojis into the composer from the smile button (32 emojis, inserted at the cursor).
- **FAQ section** — common questions (accounts, privacy, ping, theme) on the landing page.
- **Join gate never hangs** — the volume `MutationObserver` is scoped to the remote-audio container (it previously watched the whole body and retriggered itself, freezing the page before the name form could be used); storage access at boot is guarded, fonts load non-blocking, and a `<noscript>` fallback explains the JS requirement.
- **Live ping counter** — shows round-trip latency to the server (Socket.IO echo in a room, HTTP `GET /api/ping` elsewhere), with quality (excellent / fair / poor), average, jitter, and a sparkline chart in the room's Connection card. Press `P` to refresh.
- **Improved dark design** — deep-navy surfaces, visible hairline borders with an accent glow, dark scrollbars, layered blue ambience gradients, tabular mono numerals for codes/ping/timers, and balanced typography. Light/dark surfaces share semantic tokens (`--color-border`, `--color-surface`, `--glow-accent`…).
- **Display settings** — text size (small / normal / large), chat density (comfortable / compact), motion on/off, speaker volume, and mention notifications (browser Notification API), all saved in `hush:settings`.
- **Focus mode** — hide the sidebar for a wider stage (`F`, or the focus button in the stage header / People panel).
- **Session timer** — shows how long you have been in the room, next to the ping badge.
- **Edit and delete your messages** — inline editing with `Enter` to save / `Esc` to cancel, plus delete with confirmation; both sync to everyone and persist (`edited` label shown).
- **Draft persistence** — an unsent message is saved per room and restored when you return.
- **Live landing stats** — the home page shows rooms online now and server uptime from `GET /api/health`, plus three new feature cards (dark theme, ping, focus/display, edit/delete).
- **Room codes and invite links** — every room has a short code (for example `K7M-2QX`) and a copyable link.
- **Text chat with history** — messages are saved per room in `data/`, so late joiners can catch up.
- **Voice and video** — WebRTC peer-to-peer media with mute, camera, speaking detection, and audio playback handling.
- **Screen sharing** — share a tab, window, or display. Camera can stay on while sharing, and multiple shares can be cycled from the stage.
- **File and image sharing** — up to 8 MB per file, with an allow-list of image, document, and zip types.
- **Message reactions and floating reactions** — react to messages, or send an emoji that floats across the call stage.
- **Chat search** — filter messages by text, author, or file name, with highlighted matches and a result count.
- **Room tools** — save the transcript as a text file, mute notification sounds, open the shortcuts dialog, or jump straight to search.
- **Message helpers** — copy message text, click links, and highlight `@mentions` (your own name is emphasized).
- **Small-room features** — participant list, typing indicators, unread badge, raise hand, join preferences, reconnect/rejoin, and keyboard shortcuts.
- **Responsive layout** — the room stacks cleanly on phones and tablets.
- **Mic enhancement (`mic_ev1`)** — see [`mic/README.md`](./mic/README.md): WebAudio chain (high-pass/low-pass, smart gate, spectral suppressor, limiter, AGC + optional AudioWorklet), wired fail-safe after `MicFx` in rooms and server voice. Settings live in `hush:mic-settings` (`enhance`, `enhanceStrength`, `micVersion: 'ev1'`). The evolutionary plan is `mic_ev1 → mic_ev1.9 → mic_ev2` (full docs in `mic/` + `mic/CHANGELOG.md`).
- **Server sessions (A1)** — every create/join issues an opaque session token bound to device+server (`X-Session-Token` header or `sessionToken` payload, stored in `sessionStorage` as `hush:session:<serverId>`). A valid token wins over the raw `deviceId` on privileged calls; `deviceId`-only calls still work during migration.
- **Server policies (N1–N4)** — owner-only channels, 10 servers per device (plus 100 global), ownership transfer (`POST /api/servers/:id/transfer { toDeviceId }`), per-server upload quota (512 MB, `UPLOAD_QUOTA_BYTES`), crypto invites (10-char).

## Quick start

```powershell
cd "D:\P2P app"
npm.cmd install
npm.cmd start
```

Then open <http://localhost:3000>.

> On Windows PowerShell, use `npm.cmd` if script execution is disabled.

### Other scripts

```powershell
npm.cmd run dev    # restart on file changes (Node --watch)
npm.cmd test       # unit + Socket.IO integration tests
```

## Configuration

Environment variables (all optional):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Chat history JSON files |
| `UPLOADS_DIR` | `./uploads` | Uploaded files |
| `HUSH_TRUST_PROXY` | `0` | Set to `1` ONLY behind a known reverse proxy (else `X-Forwarded-For` is spoofable) |
| `UPLOAD_QUOTA_BYTES` | `536870912` (512 MB) | Per-server upload storage budget |
| `GIPHY_API_KEY` | *(none — GIF search disabled, direct .gif links still work)* | Giphy API key, **server-only**. Set it as an env var or in the gitignored `.env` file (`cp .env.example .env`). It is never served to browsers. |

Example:

```powershell
$env:PORT = "8080"
npm.cmd start
```

## How it works

```
server.js
└── src/app.js          Express, Multer uploads, Socket.IO server, security headers
    ├── src/realtime.js room join/leave, chat, reactions, presence, WebRTC signaling
    ├── src/rooms.js    room codes, validation, chained JSON persistence
    ├── src/servers.js  permanent servers + channels (data/servers.json)
    └── src/constants.js limits and allow-lists
```

The frontend is plain ES modules with no bundler:

```
public/
├── index.html          landing page
├── room.html           room shell and SVG icon sprite
├── 404.html
├── css/                tokens, base, landing, and room styles
└── js/
    ├── landing.js
    ├── room.js         room state, chat, reactions, controls, search, tools
    ├── room/media.js   MediaMesh WebRTC mesh implementation
    ├── i18n.js         language detection, static DOM translation, t()
    ├── i18n/
    │   ├── ui.js       dynamic English → Arabic dictionary
    │   └── static-ar.js static English → Arabic map
    ├── lang-boot.js    applies the saved language before first paint
    └── static-page.js  language toggle and title for the 404 page
```

### WebRTC mesh

Each pair of participants opens two `RTCPeerConnection`s:

- `media` — microphone and camera
- `screen` — screen share

Both channels pre-create transceivers in `sendrecv` mode, so turning the mic, camera, or screen on later uses `replaceTrack()` without renegotiation. The joiner is always the initiator. Signaling is relayed by Socket.IO; media never passes through the server.

STUN servers are configured, but there is **no TURN server**. Peers behind strict/symmetric NATs may fail to connect. This is intended for small rooms on friendly networks.

## Privacy notes

- Media is encrypted in transit by WebRTC (DTLS-SRTP) and travels peer-to-peer.
- **Chat is not end-to-end encrypted.** Messages and files are stored on the server that runs Hush.
- There is no authentication. Anyone with the room link can join, and history is readable by anyone who joins that room.
- Room history is capped at 200 messages per room and is purged after 7 days of file inactivity. Empty rooms are dropped after 30 minutes of inactivity.
- Uploaded files are served from `/uploads` with a restrictive content security policy.

Do not use this demo for sensitive conversations without adding authentication, a TURN server, and end-to-end encryption for chat.

## Limits

- 12 participants per room
- 2,000 characters per message
- 8 MB per upload
- Room codes: 4–12 alphanumeric characters
- Display names: 32 characters

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Jump to chat search |
| `?` | Open the shortcuts dialog |
| `M` | Mute / unmute microphone |
| `V` | Camera on / off |
| `S` | Start / stop screen sharing |
| `H` | Raise / lower hand |
| `C` | Switch between Chat and People |
| `T` | Toggle dark / light theme |
| `F` | Toggle focus mode |
| `P` | Refresh ping |
| `B` | Open / close the soundboard |
| `D` | Deafen (mute all speakers for you) |
| `Esc` | Close menus, dialogs, and reaction popovers |

Shortcuts are ignored while you are typing in a field.

## Tests

```powershell
npm.cmd test
```

The suite covers room helpers, message and reaction persistence, HTTP health/room endpoints, a two-client chat/reaction/presence flow, the 12-person room cap, and the bilingual UI: dictionary completeness, placeholder parity, used-key coverage, static HTML coverage, early language boot, and the developer credit on every page.

Static checks also run with `node --check` on every browser module.
