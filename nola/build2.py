"""New Orleans, cut 2: the whole album over four songs.

Follows STYLE.md (held opening, cuts on the beat, real camera movement, the teal/warm grade) plus the
edits asked for on top of it: yellow scene text, photos landing on the beat over the video, and
song-to-song transitions. Songs run in the order asked: Lover Is A Day, Wolf Like Me, Nonchalant,
Dominos (the singer's own song, so it scores the Siberia show).

    python3 build2.py            # render everything (cached shots are reused)
    python3 build2.py --plan     # print the timeline only
    python3 build2.py --only 1   # render and composite chapter 1 only
"""
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW, MUSIC, OUT = f"{ROOT}/raw", f"{ROOT}/music", f"{ROOT}/out"
B = f"{ROOT}/build2"
FPS_EXPR, FPS = "24000/1001", 24000 / 1001
W, H = 1920, 1080
YELLOW = (249, 234, 84)                                   # the Japan reference's title yellow (STYLE.md)
FONT = "/usr/share/fonts/X11/Type1/c0648bt_.pfb"         # Bitstream Charter
FONT_I = "/usr/share/fonts/X11/Type1/c0649bt_.pfb"       # Bitstream Charter Italic

D = "dji_mimo_20260912_"
CLIP = {
    "orang": "20260912_102753.mp4", "eleph": "20260912_103908.mp4", "eleph2": "20260912_104058.mp4",
    "fq": "20260912_151407.mp4", "gig_a": "20260912_210252.mp4", "gig_b": "20260912_215243.mp4",
    "late1": "20260912_225951.mp4", "late2": "20260912_233812.mp4",
    "insect": D + "161356_0211_1789259076097_video.mp4", "atrium": D + "161652_0212_1789259079132_video.mp4",
    "river": D + "161718_0213_1789259081576_video.mp4", "garden": D + "161810_0214_1789259087256_video.mp4",
    "butterfly": D + "161850_0215_1789259089485_video.mp4", "gator": D + "162110_0216_1789259095696_video.mp4",
    "ray": D + "162308_0217_1789259098545_video.mp4", "jungle": D + "162606_0218_1789259103723_video.mp4",
    "vert": D + "162852_0219_1789259107177_video.mp4", "tunnel": D + "163000_0220_1789259110859_video.mp4",
    "tank": D + "163350_0221_1789259117354_video.mp4", "rays2": D + "163520_0222_1789259118260_video.mp4",
    "mall": D + "165352_0224_1789259126741_video.mp4", "bluetun": D + "182320_0225_1789259136795_video.mp4",
    "color": D + "182404_0226_1789259139563_video.mp4", "mirror": D + "183400_0227_1789259144226_video.mp4",
}
PHOTO = [  # the album's 21 stills, in the order they were taken
    "20260912_102737.jpg", "20260912_110144.jpg", "20260912_110151.jpg", "20260912_111540.jpg",
    "20260912_111718.jpg", "20260912_115951.jpg", "20260912_115956.jpg", "20260912_122830.jpg",
    "20260912_132811.jpg", "20260912_134819.jpg", "20260912_134831.jpg", "20260912_144030.jpg",
    "20260912_144247.jpg", "20260912_144256.jpg", "20260912_162347.jpg", "20260912_181113.jpg",
    "20260912_181956.jpg", "20260912_182316.jpg", "20260912_184357.jpg", "20260912_184614.jpg",
    D + "163350_0221_1789259117354_video.jpg",
]
SONG = {
    "lover": ("lover.mp3", {}),
    "wolf": ("wolf like me.mp3", {"start_bpm": 170}),   # ~172 BPM; the default prior halves it
    "nonchalant": ("Nonchalant_KLICKAUD.mp3", {}),
    "dominos": ("Dominos_KLICKAUD.mp3", {}),
}

# Card layouts: (center x, center y, rotation in degrees) for each slot of a stack.
L1 = [(0.66, 0.50, 4)]
L2 = [(0.37, 0.50, -5), (0.63, 0.52, 5)]
L3 = [(0.50, 0.52, -3), (0.31, 0.47, 6), (0.69, 0.50, -6)]
L4 = [(0.50, 0.50, -3), (0.30, 0.46, 6), (0.70, 0.54, -6), (0.50, 0.57, 3)]
L5 = [(0.50, 0.52, -3), (0.29, 0.47, 7), (0.71, 0.50, -6), (0.40, 0.57, 4), (0.61, 0.45, -4)]


def cap(title, sub):
    return {"kind": "caption", "lines": (title, sub)}


# ---- the cut -------------------------------------------------------------------------------------
# Shot keys: clip/tin (source, in-point s) or photo (album index) or black; until = end as a beat
# offset from the chapter anchor, b = length in beats, sec = length in seconds; fit cover|fill;
# y = crop position for tall sources; speed (0.8 turns 30 fps into native 24 fps slow motion);
# fx = fade_in / fade_out / whip_in / whip_out; cards = [(photo index or ("frame", clip, t), beat, slot)];
# text = caption/title/card/end with optional t0/t1 (seconds from shot start).
CHAPTERS = [
    {   # 1 · Lover Is A Day: the day, from the zoo to the French Quarter
        "song": "lover", "anchor": 42.07, "begin_time": 0.0,
        "fade_out": 3.0,
        "shots": [
            dict(clip="river", tin=5.2, until=-52, text={"kind": "title", "t0": 1.4, "t1": 6.4}),
            dict(clip="orang", tin=7.3, y=0.85, b=8, text=cap("THE ZOO", "10:27 am")),
            dict(clip="orang", tin=14.0, y=0.1, b=4),
            dict(clip="orang", tin=18.3, y=0.6, b=8, layout=L3, cards=[(0, 0), (1, 2), (2, 4)]),
            dict(clip="eleph", tin=3.0, y=0.55, speed=0.5, b=8),
            dict(clip="eleph2", tin=0.2, y=0.55, b=4, layout=L2, cards=[(3, 0), (4, 2)]),
            dict(photo=5, fit="fill", b=4),
            dict(photo=6, fit="fill", b=4),
            dict(photo=7, y=0.55, b=8),
            dict(photo=9, fit="fill", b=8, layout=L2, cards=[(8, 2), (10, 4)], text=cap("LUNCH", "1:28 pm")),
            dict(photo=11, y=0.40, b=8, layout=L2, cards=[(12, 3), (13, 5)],
                 text=cap("ST. LOUIS CATHEDRAL", "2:40 pm")),
            dict(clip="fq", tin=0.3, fit="fill", b=8, fx=["fade_out"], text=cap("FRENCH QUARTER", "3:14 pm")),
        ],
    },
    {   # 2 · Wolf Like Me: insectarium and aquarium; the kick lands at 17.53 s
        "song": "wolf", "anchor": 17.53, "begin": -32,
        "fade_in": 1.2, "fade_out": 0.35,
        "shots": [
            dict(clip="insect", tin=3.8, b=16, fx=["fade_in"], text=cap("INSECTARIUM", "4:13 pm")),
            dict(clip="atrium", tin=12.3, b=16),
            dict(clip="insect", tin=18.9, b=8),
            dict(clip="insect", tin=41.5, b=8),
            dict(clip="insect", tin=86.0, b=8),
            dict(clip="butterfly", tin=3.3, b=8),
            dict(clip="river", tin=2.0, b=8, text=cap("MISSISSIPPI RIVER", "4:17 pm")),
            dict(clip="river", tin=13.6, b=8),
            dict(clip="garden", tin=16.9, b=8, layout=L3,
                 cards=[(("frame", "river", 15.4), 2), (("frame", "garden", 35.4), 4), (("frame", "garden", 29.3), 6)]),
            dict(clip="garden", tin=32.0, b=8),
            dict(clip="gator", tin=1.5, b=8, text=cap("AQUARIUM", "4:21 pm")),
            dict(clip="gator", tin=43.6, b=8),
            dict(clip="ray", tin=5.0, b=8),
            dict(clip="ray", tin=11.8, b=8, layout=L1, cards=[(14, 4)]),
            dict(clip="jungle", tin=9.5, b=8),
            dict(clip="jungle", tin=20.8, b=8),
            dict(clip="vert", tin=1.0, fit="fill", b=8),
            dict(clip="tunnel", tin=1.5, b=8),
            dict(clip="tunnel", tin=7.5, b=4),
            dict(clip="tank", tin=11.0, b=4),
            dict(clip="tunnel", tin=21.8, b=8),
            dict(clip="tank", tin=16.5, b=8),
            dict(clip="vert", tin=20.0, fit="fill", b=8),
            dict(clip="rays2", tin=5.0, b=8),
            dict(clip="tank", tin=44.5, b=16, layout=L3,
                 cards=[(20, 4), (("frame", "tunnel", 22.4), 8), (("frame", "tank", 50.2), 12)]),
            dict(clip="tunnel", tin=31.0, b=8, fx=["whip_out"]),
        ],
    },
    {   # 3 · Nonchalant: the mall, then the light rooms; the band drops back in hard at 40.68 s
        "song": "nonchalant", "anchor": 40.68, "begin_time": 0.0,
        "fade_out_from_shot": 22, "fade_out": 2.2,
        "shots": [
            dict(clip="mall", tin=1.0, until=-63, fx=["whip_in"], text=dict(cap("THE MALL", "4:53 pm"), t0=0.6)),
            dict(clip="mall", tin=20.0, b=7),
            dict(clip="mall", tin=38.1, b=4),
            dict(clip="mall", tin=5.4, b=4),
            dict(photo=15, fit="fill", b=4, text=cap("LIGHT ROOMS", "6:11 pm")),
            dict(clip="bluetun", tin=23.0, s=0.85, b=8),
            dict(clip="color", tin=4.1, s=0.8, b=4),
            dict(clip="color", tin=6.8, s=0.8, b=4, layout=L1, cards=[(16, 2)]),
            dict(photo=17, fit="fill", s=0.85, b=4),
            dict(clip="bluetun", tin=49.5, s=0.85, b=4),
            dict(clip="color", tin=28.3, s=0.8, b=4),
            dict(clip="mirror", tin=1.5, s=0.8, b=4),
            dict(clip="mirror", tin=33.5, s=0.8, b=4),
            dict(clip="mirror", tin=37.0, s=0.8, b=4),
            dict(clip="bluetun", tin=3.3, s=0.85, b=4),
            dict(clip="mirror", tin=19.6, s=0.8, b=8, layout=L4,
                 cards=[(18, 0), (19, 2), (("frame", "color", 12.3), 4), (("frame", "mirror", 40.4), 6)]),
            dict(clip="color", tin=9.6, s=0.8, b=4),
            dict(clip="mirror", tin=23.2, s=0.8, b=4),
            dict(clip="bluetun", tin=63.3, s=0.85, b=4),
            dict(clip="color", tin=15.0, s=0.8, b=4),
            dict(clip="mirror", tin=5.3, s=0.8, b=4),
            dict(clip="mirror", tin=40.4, s=0.8, b=4),
            dict(black=True, sec=2.4, text={"kind": "card", "lines": ("SIBERIA", "9:02 pm"), "t0": 0.25, "t1": 2.25}),
        ],
    },
    {   # 4 · Dominos: his song, his show; then the day in photos, then the end card
        "song": "dominos", "anchor": 0.07, "begin_time": 0.0,
        "fade_out": 6.0, "tail_silence": 1.0,
        "shots": [
            dict(clip="gig_b", tin=5.5, y=0.33, speed=1.0, until=8),
            dict(clip="gig_a", tin=16.0, y=0.33, speed=1.0, b=8),
            dict(clip="late1", tin=2.0, y=0.30, speed=1.0, b=8),
            dict(clip="gig_b", tin=9.1, y=0.33, speed=1.0, b=8),
            dict(clip="gig_a", tin=2.8, y=0.33, speed=1.0, b=4),
            dict(clip="late1", tin=6.9, y=0.30, speed=1.0, b=4),
            dict(clip="gig_a", tin=12.5, y=0.33, speed=1.0, b=8),
            dict(clip="gig_b", tin=0.5, y=0.33, speed=1.0, b=4),
            dict(clip="late1", tin=5.3, y=0.30, speed=1.0, b=4),
            dict(clip="gig_a", tin=8.0, y=0.33, speed=1.0, b=8),
            dict(clip="gig_a", tin=20.0, y=0.33, speed=1.0, b=4),
            dict(clip="late2", tin=1.8, y=0.30, speed=1.0, b=4, text=cap("STILL OUT", "11:38 pm")),
            dict(clip="late2", tin=5.0, y=0.30, speed=1.0, b=8),
            dict(clip="gig_b", tin=12.2, y=0.33, speed=1.0, b=4),
            dict(clip="late1", tin=8.0, y=0.30, speed=1.0, b=4),
            dict(clip="gig_b", tin=2.5, y=0.33, speed=1.0, b=8),
            dict(clip="gig_a", tin=3.0, y=0.33, speed=1.0, b=44, dim="all", groups=[
                (L5, [(0, 0), (1, 2), (2, 4), (3, 6), (4, 8)], 10),
                (L3, [(5, 10), (6, 12), (7, 14)], 16),
                (L3, [(8, 16), (9, 18), (10, 20)], 22),
                (L3, [(11, 22), (12, 24), (13, 26)], 28),
                (L2, [(14, 28), (20, 30)], 32),
                (L5, [(15, 32), (16, 34), (17, 36), (18, 38), (19, 40)], 44),
            ]),
            dict(photo=7, y=0.55, b=16, fx=["fade_out"], text={"kind": "end", "t0": 0.7, "t1": 4.1}),
            dict(black=True, sec=1.0),
        ],
    },
]


# ---- helpers ------------------------------------------------------------------------------------
def run(cmd):
    subprocess.run(cmd, check=True)


def song_grid(song):
    """Detected beats for the song, extended evenly before the first and after the last beat."""
    path = f"{B}/beats_{song}.npy"
    if os.path.exists(path):
        beats = np.load(path)
    else:
        import librosa
        fname, kw = SONG[song]
        y, sr = librosa.load(f"{MUSIC}/{fname}", sr=22050, mono=True)
        _, beats = librosa.beat.beat_track(y=y, sr=sr, units="time", **kw)
        np.save(path, beats)
    p = float(np.median(np.diff(beats)))
    pre = beats[0] - p * np.arange(1, int(beats[0] / p) + 2)
    post = beats[-1] + p * np.arange(1, 400)
    return np.concatenate([pre[::-1], beats, post])


def layout_chapter(ch):
    """Song-time boundaries and frame counts for every shot, plus chapter-local beat times."""
    g = song_grid(ch["song"])
    a = int(np.argmin(abs(g - ch["anchor"])))
    if "begin_time" in ch:
        t0, idx = ch["begin_time"], None
    else:
        idx = a + ch["begin"]
        t0 = float(g[idx])
    bounds, idxs, t = [t0], [idx], t0
    for s in ch["shots"]:
        if "until" in s:
            idx = a + s["until"]
            t = float(g[idx])
        elif "b" in s:
            idx = idx + s["b"]
            t = float(g[idx])
        else:
            t, idx = t + s["sec"], None
        bounds.append(t)
        idxs.append(idx)
    frames = [round((x - t0) * FPS) for x in bounds]
    beat_local = lambda i: float(g[i]) - t0               # grid index -> chapter-local seconds
    return t0, bounds, idxs, frames, beat_local


def grade(s):
    return ",".join([
        f"eq=gamma={s.get('g', 1.0)}:saturation={s.get('s', 0.92)}",
        "curves=all='0/0.09 0.25/0.25 0.5/0.51 0.75/0.76 1/0.93'",
        "colorbalance=rs=-0.04:gs=0.00:bs=0.05:rm=0.02:bm=-0.02:rh=0.06:gh=0.02:bh=-0.05",
        "vignette=angle=PI/5",
    ])


def fx_chain(fx, dur):
    f = []
    if "fade_in" in fx:
        f.append("fade=t=in:st=0:d=0.9")
    if "fade_out" in fx:
        f.append(f"fade=t=out:st={dur - 1.6:.3f}:d=1.6")
    # whip: horizontal smear that builds over the last (or first) quarter second, like a fast pan
    if "whip_out" in fx:
        for sig, span in ((10, 0.30), (28, 0.20), (60, 0.10)):
            f.append(f"gblur=sigma={sig}:sigmaV=0.3:enable='gte(t,{dur - span:.3f})'")
    if "whip_in" in fx:
        for sig, span in ((10, 0.30), (28, 0.20), (60, 0.10)):
            f.append(f"gblur=sigma={sig}:sigmaV=0.3:enable='lte(t,{span:.3f})'")
    return f


def render_shot(ci, k, s, nframes):
    out = f"{B}/c{ci}_s{k:02d}.mp4"
    dur = nframes / FPS
    sig = repr((s, nframes))
    if os.path.exists(out) and os.path.exists(out + ".sig") and open(out + ".sig").read() == sig:
        return out
    y = s.get("y", 0.5)
    cover = (f"crop=iw:'min(ih,iw*9/16)':0:'(ih-min(ih,iw*9/16))*{y}',"
             f"scale={W}:{H}:flags=lanczos,setsar=1")
    fill = ("split=2[bgs][fgs];[bgs]scale=480:270:force_original_aspect_ratio=increase,crop=480:270,"
            f"gblur=sigma=10,scale={W}:{H},eq=brightness=-0.10:saturation=0.8[bg];"
            f"[fgs]scale=-2:{H}:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:0,setsar=1")
    fit = fill if s.get("fit") == "fill" else cover
    post = ",".join([grade(s)] + fx_chain(s.get("fx", []), dur) + ["format=yuv420p"])
    if s.get("black"):
        cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=black:s={W}x{H}:r={FPS_EXPR}",
               "-vf", "format=yuv420p"]
    elif "photo" in s:
        cmd = ["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", FPS_EXPR,
               "-i", f"{RAW}/{PHOTO[s['photo']]}", "-filter_complex", f"[0:v]{fit},{post}[v]", "-map", "[v]"]
    else:
        src = f"{RAW}/{CLIP[s['clip']]}"
        fps = float(eval(subprocess.check_output(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
             "-of", "csv=p=0", src], text=True).split()[0].strip(",")))
        speed = s.get("speed", 0.8 if fps < 31 else 0.5)
        cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(s["tin"]), "-t", f"{dur * speed + 0.3:.3f}", "-i", src,
               "-filter_complex", f"[0:v]setpts=PTS/{speed},fps={FPS_EXPR},{fit},{post}[v]", "-map", "[v]", "-an"]
    cmd += ["-frames:v", str(nframes), "-c:v", "libx264", "-preset", "veryfast", "-crf", "14",
            "-pix_fmt", "yuv420p", "-r", FPS_EXPR, out]
    run(cmd)
    open(out + ".sig", "w").write(sig)
    return out


# ---- stills for cards --------------------------------------------------------------------------
def graded_still(item):
    """A graded JPEG of an album photo or of a frame pulled from a clip."""
    os.makedirs(f"{B}/stills", exist_ok=True)
    look = ("eq=saturation=0.92,curves=all='0/0.07 0.25/0.25 0.5/0.51 0.75/0.76 1/0.95',"
            "colorbalance=rs=-0.03:bs=0.04:rh=0.05:gh=0.02:bh=-0.04")
    if isinstance(item, int):
        out = f"{B}/stills/p{item:02d}.jpg"
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", f"{RAW}/{PHOTO[item]}",
               "-vf", f"scale='if(gt(iw,ih),1400,-2)':'if(gt(iw,ih),-2,1400)',{look}", "-q:v", "3", out]
    else:
        _, clip, t = item
        out = f"{B}/stills/f_{clip}_{t}.jpg"
        cmd = ["ffmpeg", "-v", "error", "-y", "-ss", str(t), "-i", f"{RAW}/{CLIP[clip]}", "-frames:v", "1",
               "-vf", f"scale=1280:-2,{look}", "-q:v", "3", out]
    if not os.path.exists(out):
        run(cmd)
    return out


def make_card(item, angle):
    """A white-bordered print of the still, turned a few degrees, with a soft drop shadow (RGBA PNG)."""
    os.makedirs(f"{B}/cards", exist_ok=True)
    name = f"p{item:02d}" if isinstance(item, int) else f"f_{item[1]}_{item[2]}"
    out = f"{B}/cards/{name}_{angle}.png"
    if os.path.exists(out):
        return out
    im = Image.open(graded_still(item)).convert("RGB")
    if im.width > im.height:
        size = (620, round(im.height * 620 / im.width))
    else:
        size = (round(im.width * 540 / im.height), 540)
    im = im.resize(size, Image.LANCZOS)
    border = 16
    card = Image.new("RGBA", (im.width + 2 * border, im.height + 2 * border), (246, 243, 236, 255))
    card.paste(im, (border, border))
    rot = card.rotate(angle, resample=Image.BICUBIC, expand=True)
    pad = 48
    canvas = Image.new("RGBA", (rot.width + 2 * pad, rot.height + 2 * pad), (0, 0, 0, 0))
    shadow = Image.new("RGBA", rot.size, (0, 0, 0, 255))
    shadow.putalpha(rot.getchannel("A").point(lambda v: int(v * 0.55)))
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(shadow, (pad + 6, pad + 16))
    canvas = Image.alpha_composite(canvas, layer.filter(ImageFilter.GaussianBlur(14)))
    top = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    top.paste(rot, (pad, pad))
    canvas = Image.alpha_composite(canvas, top)
    canvas.save(out)
    return out


# ---- yellow type ---------------------------------------------------------------------------------
def text_png(name, lines, align):
    """lines: [(text, font path, size, tracking em, alpha)]. Returns (png, width, height, pad)."""
    os.makedirs(f"{B}/text", exist_ok=True)
    out = f"{B}/text/{name}.png"
    fonts = [ImageFont.truetype(f, size) for _, f, size, _, _ in lines]
    widths, heights = [], []
    for (text, _, size, track, _), fnt in zip(lines, fonts):
        widths.append(sum(fnt.getlength(c) for c in text) + track * size * (len(text) - 1))
        asc, desc = fnt.getmetrics()
        heights.append(asc + desc)
    gap = 10
    pad = 40
    w = int(max(widths)) + 2 * pad
    h = int(sum(heights) + gap * (len(lines) - 1)) + 2 * pad
    ink = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(ink)
    y = pad
    for (text, _, size, track, alpha), fnt, tw, th in zip(lines, fonts, widths, heights):
        x = pad if align == "left" else pad + (max(widths) - tw) / 2
        for c in text:
            d.text((x, y), c, font=fnt, fill=YELLOW + (int(255 * alpha),))
            x += fnt.getlength(c) + track * size
        y += th + gap
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    shadow.putalpha(ink.getchannel("A").point(lambda v: int(v * 0.55)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(9))
    base = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    base.alpha_composite(shadow, (0, 3))
    base.alpha_composite(ink)
    base.save(out)
    return out, w, h, pad


def text_layer(name, spec):
    """Place a text spec. Returns (png, x, y)."""
    kind = spec["kind"]
    if kind == "caption":
        title, sub = spec["lines"]
        png, w, h, pad = text_png(name, [(title, FONT, 56, 0.12, 1.0), (sub, FONT_I, 35, 0.02, 0.92)], "left")
        return png, 112 - pad, H - 100 - (h - pad)
    if kind == "title":
        png, w, h, pad = text_png(name, [("NEW ORLEANS", FONT, 118, 0.10, 1.0),
                                         ("la Nouvelle-Orléans", FONT_I, 44, 0.02, 0.92)], "center")
    elif kind == "card":
        a, b = spec["lines"]
        png, w, h, pad = text_png(name, [(a, FONT, 112, 0.16, 1.0), (b, FONT_I, 44, 0.02, 0.92)], "center")
    else:  # end card
        png, w, h, pad = text_png(name, [("NEW ORLEANS", FONT, 92, 0.12, 1.0), ("09 · 12 · 26", FONT_I, 40, 0.06, 0.95),
                                         ("music · Lover Is A Day · Wolf Like Me · Nonchalant · Dominos", FONT_I, 26, 0.02, 0.85)],
                                  "center")
    return png, (W - w) // 2, (H - h) // 2


# ---- chapters ------------------------------------------------------------------------------------
def composite(ci, ch, files, frames, idxs, beat_local):
    """Join the chapter's shots and lay the cards, the dimming under them, the type and the grain on top."""
    total = frames[-1] / FPS
    starts = [f / FPS for f in frames]
    layers, dims = [], []                                   # (png, x, y, t_on, t_off, fade)
    for k, s in enumerate(ch["shots"]):
        t_start, t_end = starts[k], starts[k + 1]
        groups = s.get("groups") or ([(s["layout"], s["cards"], None)] if s.get("cards") else [])
        for layout, cards, until in groups:
            t_off = beat_local(idxs[k] + until) if until is not None else t_end
            t_first = None
            for slot, (item, at) in enumerate(cards):
                cx, cy, ang = layout[slot]
                png = make_card(item, ang)
                cw, chh = Image.open(png).size
                t_on = beat_local(idxs[k] + at)
                t_first = t_on if t_first is None else t_first
                layers.append((png, int(cx * W - cw / 2), int(cy * H - chh / 2), t_on, t_off, False))
            if s.get("dim") != "all" and t_first is not None:
                dims.append((t_first, t_off))
        if s.get("dim") == "all":
            dims.append((t_start, t_end))
        if s.get("text"):
            spec = s["text"]
            png, x, y = text_layer(f"c{ci}_s{k:02d}", spec)
            t_on = t_start + spec.get("t0", 0.35)
            t_off = t_start + spec.get("t1", min(t_end - t_start - 0.3, 3.9))
            layers.append((png, x, y, t_on, t_off, True))

    inputs = ["-f", "concat", "-safe", "0", "-i", f"{B}/c{ci}_list.txt"]
    with open(f"{B}/c{ci}_list.txt", "w") as f:
        f.writelines(f"file '{p}'\n" for p in files)
    for png, *_ in layers:
        inputs += ["-loop", "1", "-framerate", FPS_EXPR, "-t", f"{total:.3f}", "-i", png]
    chain = ["[0:v]setpts=PTS-STARTPTS"]
    if dims:
        on = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in dims)
        chain.append(f"gblur=sigma=5:enable='{on}',eq=brightness=-0.06:saturation=0.9:enable='{on}'")
    graph = [",".join(chain) + "[v0]"]
    for i, (png, x, y, t_on, t_off, fade) in enumerate(layers, start=1):
        src = f"[{i}:v]"
        if fade:
            graph.append(f"[{i}:v]format=rgba,fade=t=in:st={t_on:.3f}:d=0.35:alpha=1,"
                         f"fade=t=out:st={t_off - 0.35:.3f}:d=0.35:alpha=1[l{i}]")
            src = f"[l{i}]"
        graph.append(f"[v{i - 1}]{src}overlay=x={x}:y={y}:enable='between(t,{t_on:.3f},{t_off:.3f})'[v{i}]")
    graph.append(f"[v{len(layers)}]noise=alls=3:allf=t,format=yuv420p[out]")
    out = f"{B}/chapter{ci}.mp4"
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(graph), "-map", "[out]",
         "-frames:v", str(frames[-1]), "-c:v", "libx264", "-preset", "veryfast", "-crf", "14",
         "-pix_fmt", "yuv420p", "-r", FPS_EXPR, out])
    return out, total


def loudness(path, start, dur):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}",
                          "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    return float(out.split("Summary:")[1].split("I:")[1].split("LUFS")[0])


def main():
    os.makedirs(B, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    only = int(sys.argv[sys.argv.index("--only") + 1]) if "--only" in sys.argv else None
    plans = []
    for ci, ch in enumerate(CHAPTERS, start=1):
        t0, bounds, idxs, frames, beat_local = layout_chapter(ch)
        plans.append((t0, bounds, idxs, frames, beat_local))
        print(f"chapter {ci} · {ch['song']} from {t0:.2f}s · {frames[-1] / FPS:.2f}s · {len(ch['shots'])} shots")
        for k, s in enumerate(ch["shots"]):
            what = s.get("clip") or (f"photo {s['photo']}" if "photo" in s else "black")
            print(f"   {k:02d} {what:<10} {frames[k] / FPS:7.2f} -> {frames[k + 1] / FPS:7.2f}"
                  f"  ({(frames[k + 1] - frames[k]) / FPS:.2f}s)")
    print("total", sum(p[3][-1] for p in plans) / FPS)
    if "--plan" in sys.argv:
        return

    jobs = []
    for ci, (ch, plan) in enumerate(zip(CHAPTERS, plans), start=1):
        if only and ci != only:
            continue
        frames = plan[3]
        for k, s in enumerate(ch["shots"]):
            jobs.append((ci, k, s, frames[k + 1] - frames[k]))
    with ThreadPoolExecutor(max_workers=3) as pool:
        files = list(pool.map(lambda j: render_shot(*j), jobs))
    by_ch = {}
    for (ci, *_), f in zip(jobs, files):
        by_ch.setdefault(ci, []).append(f)

    chapters = []
    for ci, (ch, plan) in enumerate(zip(CHAPTERS, plans), start=1):
        if only and ci != only:
            continue
        t0, bounds, idxs, frames, beat_local = plan
        chapters.append(composite(ci, ch, by_ch[ci], frames, idxs, beat_local))
        print("chapter", ci, "composited", flush=True)
    if only:
        return

    with open(f"{B}/chapters.txt", "w") as f:
        f.writelines(f"file '{p}'\n" for p, _ in chapters)
    # music: each song trimmed to its chapter, levelled to -14 LUFS, faded, then joined end to end
    parts, graph = [], []
    for ci, (ch, plan, (_, dur)) in enumerate(zip(CHAPTERS, plans, chapters), start=1):
        path = f"{MUSIC}/{SONG[ch['song']][0]}"
        t0 = plan[0]
        gain = -14.0 - loudness(path, t0, dur)
        parts += ["-i", path]
        f = [f"atrim=start={t0:.3f}:duration={dur:.3f}", "asetpts=PTS-STARTPTS",
             "aformat=sample_rates=48000:channel_layouts=stereo", f"volume={gain:.2f}dB"]
        if ch.get("fade_in"):
            f.append(f"afade=t=in:st=0:d={ch['fade_in']}")
        tail = ch.get("tail_silence", 0.0)
        if "fade_out_from_shot" in ch:  # music decays under the black title card
            st = plan[3][ch["fade_out_from_shot"]] / FPS
            f.append(f"afade=t=out:st={st:.3f}:d={ch['fade_out']}")
        elif ch.get("fade_out"):
            f.append(f"afade=t=out:st={dur - tail - ch['fade_out']:.3f}:d={ch['fade_out']}")
        graph.append(f"[{ci}:a]" + ",".join(f) + f"[a{ci}]")
        print(f"chapter {ci} music gain {gain:+.1f} dB")
    graph.append("".join(f"[a{i}]" for i in range(1, len(chapters) + 1)) +
                 f"concat=n={len(chapters)}:v=0:a=1,alimiter=limit=0.891:level=false[a]")
    run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{B}/chapters.txt", *parts,
         "-filter_complex", ";".join(graph), "-map", "0:v", "-map", "[a]",
         "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "14M", "-bufsize", "28M",
         "-profile:v", "high", "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709",
         "-colorspace", "bt709", "-r", FPS_EXPR, "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart",
         f"{OUT}/new_orleans_cut2.mp4"])
    print("done", f"{OUT}/new_orleans_cut2.mp4")


if __name__ == "__main__":
    main()
