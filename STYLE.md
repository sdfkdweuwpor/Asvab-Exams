# Video Style Guide

These rules come from analyzing five reference videos with ffmpeg (scene detection, frame sampling, cropdetect,
signalstats, blackdetect, EBU R128 loudness) and Whisper (speech timing). The video files are kept locally in
`References/` and are not committed.

| Key | Video | Type | Length | Source file |
|---|---|---|---|---|
| **Love** | `MaFIeVgUy5w`: "What falling in love feels like" | Romantic short film, no dialogue | 1:50 | 1280×720, 29.97 fps |
| **Japan** | `ChxDEAN8EtY`: "JAPAN" cinematic travel film | Travel montage | 0:54 | 1280×720, 25 fps |
| **Swiss** | `RwkGSPp6yG0`: "Switzerland" road trip | Cinematic travel vlog, narrated | 14:54 | 1280×720, 29.97 fps |
| **Together** | `TOjTt40cvjE`: "together", scored short film | Romantic music-driven short | 4:36 | 1280×720, 23.976 fps |
| **Cabin** | `videoplayback.mp4` (source ID unknown) | Cinematic lifestyle vlog | 15:24 | 640×360, 24 fps |

> Frame sizes above are the downloaded copies (720p/360p). Resolution and bitrate say nothing about how the
> originals were shot. Deliver at 1920×1080 or higher.

---

## 1. Common patterns (do these on every edit)

### Format
- **16:9, full frame.** None of the five use permanent letterbox bars. Letterboxing (≈2.39:1) appears only
  **as a moment**: Swiss uses it for a few sequences and Cabin for about 15% of its shots. Use bars as an
  emphasis device, not as the default.
- **Frame rate:** 24 or 23.976 fps for narrative or romantic pieces (Together, Cabin). 25 or 29.97 fps
  appears in travel pieces. Default to **23.976 fps**.
- **Deliver at 1920×1080** (or 3840×2160), H.264 or H.265, yuv420p, Rec.709.

### Opening: no cuts in the first 3 seconds
- **Four of the five have zero cuts in the first 3 s.** The first cut lands at 4.2–6.5 s (Love 6.2 s,
  Japan 4.6 s, Swiss 6.5 s, Together 4.3 s). Cabin is the exception, with a cut at 1.1 s.
- Open on **one held establishing or mood shot, or a title card on black**, then let the pace pick up.
- **The title goes on in the first 2–6 s**, either over that first shot (Japan, Together, Swiss) or on black
  (Love).

### Pacing
Average and median shot length per video (in seconds):

| | Love | Japan | Swiss | Together | Cabin |
|---|---|---|---|---|---|
| Cuts | 40 | 45 | 147 | 49 | 215 |
| Average shot | 2.7 | **1.2** | 6.0 | 5.5 | 4.3 |
| Median shot | 2.0 | 0.9 | 3.2 | 4.3 | 2.5 |
| Shortest / longest | 1.1 / 13.5 | 0.3 / 6.2 | 0.4 / 42.9 | 0.3 / 19.6 | 0.3 / 80.6 |

- **Montage sections** (music only, no talking) cut every **1–3 s**. **Talking and emotional beats** hold for
  **4–15 s**.
- **The median is always well below the mean.** Most shots are short, with a few long held shots for
  contrast. Plan on roughly 70% short shots and 30% long ones.
- **Front-load the energy after the opening hold.** Japan cuts 16 times in its first quarter and 7 in its
  last. Swiss makes 67 cuts in its first quarter, then 31, 21 and 28. Slow down toward the ending.
- **Cut on the music:** hits on beats, and holds through sustained notes.

### Transitions
- **Straight cuts are the default.** Nearly every transition is a hard cut.
- **Motion cuts and whip pans:** Together and Love hide cuts inside camera or subject motion, using
  motion-blurred whips and passing foreground objects.
- **Fade or dip to black** for endings and chapter breaks.
  - **Endings:** every video ends on black. Together holds black for 11.7 s, Swiss 17.5 s (end card),
    Japan 3.6 s, and Love fades from a sunset silhouette to black.
  - **Chapters:** Swiss uses 3–7.5 s black cards between chapters. Cabin uses 1–2.5 s dips to black.
- **No flashy preset transitions** (spins, glitches, page curls) anywhere.

### Camera movement and zooms
- **Real camera movement only.** Movement comes from gimbal or handheld moves, pushes, slides and
  parallax. Comparing the start and end frames of held shots found **no digital punch-in zooms** in any of
  the five.
- **Wide/fisheye POV:** Swiss adds occasional ultra-wide selfie shots.
- **Slow motion** (Love, Together) on hair, hands and silhouettes.

### Shot vocabulary
- **Wide establishing shots:** small subject in a big frame (skyline, mountains, cabin, park under a tree).
- **Extreme close-ups:** eyes, lips, hands holding, flowers, objects.
- **Silhouettes and backlight:** subjects against sunset, windows or aquarium glass.
- **Low angles into trees or sky, and shots through glass or windows.**
- **For romantic pieces:** two-person over-the-shoulder shots, walking together from behind, hand-holding
  inserts. Love and Together build almost entirely from these.

### Color grade (measured by ffmpeg signalstats, 8-bit luma)
| | Love | Japan | Swiss | Together | Cabin |
|---|---|---|---|---|---|
| Avg luma | 78 | 79 | 84 | 85 | 70 |
| Black level (low %ile) | 31 | 34 | 34 | **42** | 28 |
| White level (high %ile) | 148 | 145 | 148 | 140 | 124 |
| Avg saturation | 12.6 | 8.9 | 12.9 | 14.2 | **4.9** |

- **Lifted blacks and rolled-off highlights.** Nothing sits at true black (0–16) or clipped white.
  Shadows sit around 28–42 and highlights top out around 124–148. This produces the "film" look.
- **Warm highlights with teal/green shadows** in every piece except Cabin: golden skin tones and sun,
  cyan/teal skies and water.
- **Moderate saturation.** Nothing is punchy. Reds (flowers, shirts, temples) are the accent colors.
- **Soft contrast** and slight halation or bloom around light sources. Swiss and Together add a vignette.
- **Default look for a romantic or cinematic edit:** black level ≈ 30–40, whites ≈ 140–150,
  saturation ≈ 12–14. Warm the mids and highlights, push the shadows teal, and keep skin natural.

### Text and titles
- **Minimal on-screen text.** One title near the start, maybe chapter words, and an end card.
- **Titles are centered, with generous empty space around them.** None of the titles uses an outline or
  box.
- **Title color is white or a warm off-white,** except Japan's yellow.
- **Serif or light humanist type for cinematic pieces.** Bold sans is only for punchy vlog callouts (Swiss,
  Cabin).

### Audio
- **Music drives every video.** Love has no speech at all. Japan has only three short ambient lines.
- **Loudness varies, so normalize the delivery to −14 LUFS for YouTube.** Measured integrated loudness
  (with loudness range) was:
  - Love −24.5 LUFS (8.6 LU)
  - Japan −18.2 LUFS (14.1 LU)
  - Swiss −17.4 LUFS (6.8 LU)
  - Together −16.0 LUFS (12.9 LU)
  - Cabin −20.7 LUFS (12.6 LU)
- **Wide dynamics are fine for cinematic pieces.** Japan, Together and Cabin have a 12–14 LU range, with
  quiet held moments against loud music swells.
- **Music ducks under voice,** covered in section 3.

---

## 2. Captions and on-screen text by video

| | Font style | Size (at 720p) | Color | Outline / shadow | Position |
|---|---|---|---|---|---|
| **Love**: opening line on black | Small transitional serif | ~14 px (≈2% of height) | White | None | Dead center on a black card, held ~6 s |
| **Japan**: title | Classic serif, all caps, CJK subtitle beneath | ~60 px caps + ~30 px kanji | **Yellow #F9EA54** | None | Center |
| **Japan**: dialogue subs | Small sans, Japanese line above English | ~14 px | Yellow | None | Bottom center |
| **Swiss**: dialogue captions | **Italic sans** (Helvetica-oblique style) | ~22 px font, 18 px glyph box (≈3% of height) | **Warm cream #F9E8C9** | None (soft shadow at most) | Bottom center, baseline ≈ 94% down |
| **Swiss**: callouts | Bold geometric sans | ~50 px | White | None | Top right |
| **Swiss**: title and narration cards | Small serif, **typed on letter by letter** | ~16 px | White | None | Center, on black |
| **Together**: title | Light lowercase humanist sans (Optima-like) | ~50 px | White #FFFEF7 | None | Center |
| **Cabin**: chapter words ("SNACK TIME", "WORKOUT") | Heavy sans, all caps, **motion-blurred reveal, placed behind the subject** (masked) | ~60–80 px at 360p (≈20% of height) | White | Blur/glow, no outline | Center, across the frame |

### Caption timing (Swiss, the only video with full captions)
- **Captions appear on the first word** of the spoken line, within one frame of speech onset.
- **Sentences are split into 4–6 word chunks.** Each chunk stays up for ~1–1.5 s, following the phrasing.
  Whisper segments averaged 8 words over 2.1 s, at 3.5 words/s.
- **Captions clear between sentences** (~0.3–0.5 s blank), so they never run continuously.
- **The other four videos do not caption speech.** Cabin is 66% speech (4.1 words/s) with no burned-in
  captions. Together's detected "speech" is mostly the sung vocal of the score.

---

## 3. Music under voice
All levels below are momentary loudness medians.

- **Swiss (talking vlog):**
  - **Music-only montages are the loudest parts,** at about −15.8 LUFS.
  - **Talking sections sit around −18.6,** and the music bed between lines drops to about −20.6.
  - **Rule:** duck the music about 5 dB when talking starts and bring it back up for montages.
- **Japan:**
  - **Music is pulled right down** (−28 LUFS) under the few spoken lines.
  - **It sits around −18 elsewhere,** a duck of about 10 dB.
- **Cabin:**
  - **Speech sits at about −24 LUFS** and the gaps between lines at about −28.
  - **Music-only sections sit at about −26.** The bed stays low and steady under a mostly spoken track.
- **Together:** music-led.
  - **Speech levels (−17.4) sit at the music level** (−18.4), so any dialogue rides on top of the score.
- **Rule for any edit with voice:** keep the music bed **8–12 dB under the dialogue** while someone talks.
  Duck with a 200–400 ms fade, and let the music swell back on the next cut or visual beat.

---

## 4. What differs between videos

| | Opening | Pace | Grade | Text | Audio |
|---|---|---|---|---|---|
| **Love** | 6 s black title card | Medium (2.7 s avg) | Warm gold, teal water, saturated reds | One small serif line | Music only, quiet master (−24.5 LUFS) |
| **Japan** | Held shot + yellow title | **Fastest** (1.2 s avg, beat-cut) | Most muted and teal (sat 8.9) | Yellow serif + bilingual subs | Music-led, ambient voices ducked |
| **Swiss** | Held landscape + small serif title | Varies: fast montage, long talking takes | Warm, vignette, some letterbox | Italic cream captions + bold callouts + typed cards | Narration + music, loudest mix |
| **Together** | Held close-up, title at ~34 s | Slow (5.5 s avg), whip pans | **Most faded** (black level 42), pastel gold/teal | One light lowercase title | Song-driven, wide dynamics |
| **Cabin** | Quick cut at 1.1 s | Medium (4.3 s avg) | **Desaturated, cool, low-key** (sat 4.9) | Big blurred chapter words behind the subject | Talking-led, low music bed |

**For romantic or cinematic edits,** follow Love and Together:
- Slower cuts
- Warm or faded grade
- One light title
- Music only, or sparse voice
- Whip-pan motion cuts
- A long fade to black at the end

**For travel montages,** follow Japan:
- A title over the first held shot
- Fast beat-matched cuts after 4–5 s

**For narrated vlogs,** follow Swiss:
- Italic cream captions
- Typed chapter cards on black
- Music ducked under voice
