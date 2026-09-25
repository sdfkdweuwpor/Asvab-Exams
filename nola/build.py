"""New Orleans edit, built per STYLE.md (romantic/cinematic: Love + Together references).

Renders each shot to a graded 1920x1080 23.976fps segment, concatenates, then adds title,
fade to black and the music bed normalized to -14 LUFS.
"""
import os, subprocess, sys
import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW, BUILD, OUT = f"{ROOT}/raw", f"{ROOT}/build", f"{ROOT}/out"
MUSIC = f"{ROOT}/music/lover.mp3"

def load_beats():
    """Beat times of the music track: from a cached .npy argument, else detected with librosa."""
    cached = [a for a in sys.argv[1:] if a.endswith(".npy")]
    if cached:
        return np.load(cached[0])
    import librosa
    y, sr = librosa.load(MUSIC, sr=22050, mono=True)
    _, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    return beats


BEATS = load_beats()
FPS = "24000/1001"
TITLE_FONT = "/usr/share/fonts/X11/Type1/c0648bt_.pfb"          # Bitstream Charter
SUB_FONT = "/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf"

D = "dji_mimo_20260912_"
C = {  # short names -> source files
    "fq": "20260912_151407.mp4", "orang": "20260912_102753.mp4", "eleph": "20260912_103908.mp4",
    "gig_a": "20260912_210252.mp4", "gig_b": "20260912_215243.mp4",
    "atrium": D + "161652_0212_1789259079132_video.mp4", "lake": D + "161718_0213_1789259081576_video.mp4",
    "garden": D + "161810_0214_1789259087256_video.mp4", "butterfly": D + "161850_0215_1789259089485_video.mp4",
    "gator": D + "162110_0216_1789259095696_video.mp4", "ray": D + "162308_0217_1789259098545_video.mp4",
    "jungle": D + "162606_0218_1789259103723_video.mp4", "tunnel": D + "163000_0220_1789259110859_video.mp4",
    "tank": D + "163350_0221_1789259117354_video.mp4", "rays2": D + "163520_0222_1789259118260_video.mp4",
    "mall": D + "165352_0224_1789259126741_video.mp4", "bluetun": D + "182320_0225_1789259136795_video.mp4",
    "color": D + "182404_0226_1789259139563_video.mp4", "mirror": D + "183400_0227_1789259144226_video.mp4",
    "cathedral": "20260912_144030.jpg", "shadows": "20260912_122830.jpg",
}

# (source, in-point s, target cut time s or beats "+Nb", options)
# options: y = vertical crop position for non-16:9 sources (0 top .. 1 bottom), g = gamma, s = saturation,
#          slow = playback speed factor (30fps * 0.8 = native 24fps slow motion)
SHOTS = [
    # --- intro: held shots, no cut in the first 3 s (title over shot 1) ---
    ("lake", 5.2, 7.3, dict()),
    ("cathedral", 0, 11.3, dict(y=0.40)),
    ("orang", 7.3, 15.3, dict(y=0.85)),
    ("eleph", 3.0, 19.3, dict(y=0.55, slow=0.5)),
    ("butterfly", 3.3, 23.4, dict(y=0.5)),
    ("atrium", 12.3, 28.1, dict()),
    ("garden", 16.9, 32.9, dict()),
    ("lake", 13.6, 37.6, dict()),
    ("garden", 32.0, 42.3, dict()),
    # --- music builds: aquarium, 4-beat cuts ---
    ("tunnel", 1.5, "+4b", dict()),
    ("tunnel", 7.5, "+4b", dict()),
    ("tank", 11.0, "+4b", dict()),
    ("ray", 5.0, "+4b", dict()),
    ("ray", 11.8, "+4b", dict()),
    ("tank", 16.5, "+4b", dict()),
    ("rays2", 5.0, "+4b", dict()),
    ("tunnel", 21.8, "+4b", dict()),
    ("tank", 44.5, "+8b", dict()),
    ("tunnel", 31.0, "+4b", dict()),
    ("jungle", 9.5, "+4b", dict()),
    ("gator", 1.5, "+4b", dict()),
    ("mall", 1.0, "+4b", dict()),
    # --- light rooms + night: fastest section, 2-4 beat cuts ---
    ("bluetun", 23.0, "+4b", dict(s=0.85)),
    ("color", 3.6, "+2b", dict(s=0.8)),
    ("color", 6.4, "+2b", dict(s=0.8)),
    ("mirror", 1.5, "+2b", dict(s=0.8)),
    ("mirror", 33.5, "+2b", dict(s=0.8)),
    ("mirror", 37.0, "+2b", dict(s=0.8)),
    ("color", 28.3, "+4b", dict(s=0.8)),
    ("bluetun", 49.5, "+4b", dict(s=0.85)),
    ("gig_b", 5.5, "+4b", dict(y=0.33, g=1.5)),
    ("gig_a", 16.0, "+4b", dict(y=0.33, g=1.6)),
    ("mirror", 19.6, "+4b", dict(s=0.8)),
    # --- ending: slow down, long holds, fade to black ---
    ("mall", 38.3, "+8b", dict()),
    ("shadows", 0, "+10b", dict(y=0.55)),
]
FADE_OUT = 2.5      # picture fade on the last shot
BLACK_TAIL = 3.0    # held black after the picture fades


def grid(t):
    """Snap a time to the beat grid (librosa beats; extrapolated before the first detected beat)."""
    p = float(np.median(np.diff(BEATS)))
    pre = BEATS[0] - p * np.arange(1, int(BEATS[0] / p) + 1)
    g = np.concatenate([pre[::-1], BEATS])
    return float(g[np.argmin(abs(g - t))]), g


def cut_times():
    t, cuts = 0.0, []
    for _, _, tgt, _ in SHOTS:
        if isinstance(tgt, str):
            n = int(tgt[1:-1])
            _, g = grid(t)
            i = int(np.argmin(abs(g - t)))
            t = float(g[i + n])
        else:
            t, _ = grid(tgt)
        cuts.append(t)
    return cuts


def probe(path):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                   "stream=r_frame_rate", "-of", "csv=p=0", path], text=True)
    n, d = out.split()[0].strip(",").split("/")
    return float(n) / float(d)


def grade(o):
    g, s = o.get("g", 1.0), o.get("s", 0.92)
    return ",".join([
        f"eq=gamma={g}:saturation={s}",
        # lifted blacks (~0.09 -> luma ~30), rolled-off whites, gentle S in the mids
        "curves=all='0/0.09 0.25/0.25 0.5/0.51 0.75/0.76 1/0.93'",
        # teal shadows, warm highlights
        "colorbalance=rs=-0.04:gs=0.00:bs=0.05:rm=0.02:bm=-0.02:rh=0.06:gh=0.02:bh=-0.05",
        "vignette=angle=PI/5",
        "noise=alls=5:allf=t",
    ])


def render_shot(i, shot, dur):
    src, tin, _, o = shot
    path = f"{RAW}/{C[src]}"
    out = f"{BUILD}/s{i:02d}.mp4"
    sig = repr((shot, round(dur, 4), grade(o)))
    if os.path.exists(out) and os.path.exists(out + ".sig") and open(out + ".sig").read() == sig:
        return out
    y = o.get("y", 0.5)
    frame = (f"crop=iw:'min(ih,iw*9/16)':0:'(ih-min(ih,iw*9/16))*{y}',"
             "scale=1920:1080:flags=lanczos,setsar=1")
    nframes = round(dur * 24000 / 1001)
    if path.endswith(".jpg"):
        cmd = ["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", FPS, "-i", path,
               "-vf", f"{frame},{grade(o)},format=yuv420p", "-frames:v", str(nframes)]
    else:
        fps = probe(path)
        # default: 30fps sources play at 0.8x -> native 23.976 slow motion
        speed = o.get("slow", 0.8 if fps < 31 else 0.5)
        need = dur * speed + 0.2
        cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{tin}", "-t", f"{need:.3f}", "-i", path,
               "-vf", f"setpts=PTS/{speed},fps={FPS},{frame},{grade(o)},format=yuv420p",
               "-an", "-frames:v", str(nframes)]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-r", FPS, out]
    subprocess.run(cmd, check=True)
    open(out + ".sig", "w").write(sig)
    return out


def main():
    cuts = cut_times()
    starts = [0.0] + cuts[:-1]
    for i, (s, e) in enumerate(zip(starts, cuts)):
        print(f"{i:02d} {SHOTS[i][0]:<10} {s:6.2f} -> {e:6.2f} ({e - s:4.2f}s)", flush=True)
    if "--plan" in sys.argv:
        return
    segs = [render_shot(i, sh, e - s) for i, (sh, s, e) in enumerate(zip(SHOTS, starts, cuts))]
    with open(f"{BUILD}/list.txt", "w") as f:
        f.writelines(f"file '{p}'\n" for p in segs)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{BUILD}/list.txt",
                    "-c", "copy", f"{BUILD}/picture.mp4"], check=True)

    end = cuts[-1]
    total = end + BLACK_TAIL
    title = (f"drawtext=fontfile={TITLE_FONT}:text='New Orleans':fontsize=76:fontcolor=0xFFFDF6:"
             "x=(w-tw)/2:y=(h-th)/2-18:alpha='if(lt(t,1.4),0,if(lt(t,2.6),(t-1.4)/1.2,if(lt(t,5.2),1,"
             "if(lt(t,6.4),(6.4-t)/1.2,0))))'")
    sub = (f"drawtext=fontfile={SUB_FONT}:text='september, twenty twenty-six':fontsize=30:"
           "fontcolor=0xFFFDF6:x=(w-tw)/2:y=(h)/2+46:alpha='0.85*if(lt(t,1.9),0,if(lt(t,3.1),(t-1.9)/1.2,"
           "if(lt(t,5.2),1,if(lt(t,6.4),(6.4-t)/1.2,0))))'")
    vf = (f"tpad=stop_mode=add:stop_duration={BLACK_TAIL}:color=black,"
          f"fade=t=out:st={end - FADE_OUT:.3f}:d={FADE_OUT},{title},{sub},format=yuv420p")
    af = (f"atrim=0:{total:.3f},afade=t=in:st=0:d=0.8,afade=t=out:st={total - 8:.3f}:d=7.5,"
          "loudnorm=I=-14:TP=-1.5:LRA=11")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{BUILD}/picture.mp4", "-i", MUSIC,
                    "-filter_complex", f"[0:v]{vf}[v];[1:a]{af},aresample=48000[a]",
                    "-map", "[v]", "-map", "[a]", "-t", f"{total:.3f}",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "16M", "-bufsize", "32M", "-profile:v", "high",
                    "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709",
                    "-colorspace", "bt709", "-r", FPS,
                    "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart",
                    f"{OUT}/new_orleans.mp4"], check=True)
    print("done", total)


if __name__ == "__main__":
    main()
