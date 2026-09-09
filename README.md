# SceneCast — Portrait Stage

![License](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)
![SillyTavern](https://img.shields.io/badge/SillyTavern-Extension-green.svg)

A SillyTavern extension that watches the AI's replies and puts character portraits on screen the moment they're mentioned — then takes them away again once they're not part of the scene anymore. 

![SceneCast in action](assets/images/screenshot-example3.png)

![SceneCast in action](assets/images/screenshot-example1.png)

![SceneCast in action](assets/images/gif-example.gif)

## What it actually does

You write trigger words for a character (usually just their name). When the AI's message contains one of those words, that character's card animates onto the stage. Stop mentioning them and the card leaves on its own after however long you've configured.

Beyond that basic loop, there's a fair bit under the hood:

- Eleven stage layouts — grid, 3D diorama, accordion, manga-style cut-ins, a cyberpunk HUD, holographic foil, and a few others. Pick whichever fits your theme.
- Visual effects (grain, scanlines, CRT, VHS glitch, falling snow, etc.) and five different exit animations.
- Cast profiles, so your fantasy party and your sci-fi crew don't bleed into each other. A profile can be bound to one character card, several cards, or a group chat.
- Trigger words support plain comma lists or full regex, plus "suppress" terms so a name you don't want to fire (e.g. someone talking *about* a clone) doesn't accidentally summon the wrong card.
- Variants — one character, several portraits (outfit changes, moods, etc.), cycled with arrows on the card itself.
- Bulk import from a folder of images, with automatic character/variant detection based on filenames.
- Scroll-sync: scroll back through the chat log and the stage rewinds to show who was actually present at that point, instead of freezing on the latest message's cast.

## Installation

1. Open the **Extensions** menu (boxes icon) in SillyTavern.
2. Click **Install Extension** at the top right.
3. Paste this URL and click **Install for me**:
```
https://github.com/DWage/ST-SceneCast
```

## Getting started

1. Open the sidebar drawer, click **Open Cast Manager**.
2. First time in, there's a short in-app guide that covers profiles, triggers, and stage design — worth the two minutes if you're not sure where to start. You can reopen it later from the `?` icon.
3. Add some characters. Three ways to do it:
   - Point **Folder Import** at a directory of portraits and let it build your cast from the filenames.
   - Drag images straight onto the panel.
   - Add a blank cast member and upload a portrait manually.
4. Set trigger words per character — these are the words SceneCast looks for in the AI's text.
5. Bind the profile you're using to the current character card, so it loads automatically next time you open that chat.
6. Talk to your character. Mentioned names should start showing up on stage.

### How filenames get parsed during import

| Filename | What happens |
|---|---|
| `Elara.png` | New character "Elara," trigger word "Elara" |
| `Elara_smiling.png` | Adds a "smiling" variant to Elara (creates her if she doesn't exist yet) |
| `Elara+Kael.png` | A shared portrait, shown if either name is mentioned |
| `Kael-Battle.png` | No underscore — this makes a *separate* character called "Kael-Battle," not a variant. Easy mistake, watch for it. |

## Tuning it

The Stage Settings panel inside Cast Manager splits into two tabs:

- **Appearance & Effects** — layout, visual effect, exit animation, which side(s) of the screen cards show on, hue shift, card scale, reduce-motion and info-bar toggles.
- **Rules & Triggers** — how cards get dismissed (by reply count, by time, or manually only), how many can be on stage at once, case sensitivity, whether to ignore text inside `<details>` blocks or inside quotes, custom ignore-markers, and scroll-sync lookback depth.

There's also an image browser built in — see everything stored on the server, which cast members are using which file, and clean up anything orphaned.

## Bugs & Feedback
 
Found a bug or have a suggestion? Please open an issue on this repository.

## License

[AGPL-3.0](LICENSE). Use it, fork it, modify it — just keep it open.

## Support

SceneCast is free and will stay that way. If you're getting good use out of it and want to help keep it going, any donation is always welcome and genuinely appreciated. PayPal/Patreon don't work where I live, so it's crypto-only:

| Coin | Address |
|---|---|
| BTC | `bc1qwd0wzu2lalw8jl8eqrpeg06z488vrk56xwhvu8` |
| ETH | `0x05Dd3A872c782FB033Df73b285c5d2fc80dc5EA1` |
| USDT (TRC-20 / Tron network only) | `TDAskD2uuNnk4VpM9c7H7ZWrP4CukbgqG6` |
| SOL | `AT97UntbEpJrXcHKgZZaLhaVmy7F5AkF3ztGMiDsRZgf` |

Double-check the network before sending, especially for USDT — TRC-20/Tron only.
