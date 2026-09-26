"""New Orleans, cut 3: cut 2 plus the sound of the day and more energy.

Changes from build2.py, as asked:
  * key moments from the clips are heard (what you said, reactions, the crowd); the music ducks under them
  * after Lover Is A Day dies down, Wolf Like Me opens on your line in the butterfly garden, builds with
    accelerating cuts, then runs fast (0.7-1.4 s cuts) with photo bursts
  * the Siberia show is cut fast on Dominos with prints of the show, crowd noise and a pulse on each bar

    python3 build3.py            # render everything (unchanged shots are reused)
    python3 build3.py --plan     # print the timeline only
    python3 build3.py --only 2   # render and composite one chapter
"""
import hashlib
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np

import build2 as b2
from build2 import CLIP, FPS, FPS_EXPR, H, L1, L2, L3, L4, L5, MUSIC, OUT, RAW, SONG, W, cap

B = f"{b2.ROOT}/build3"
L6 = L5 + [(0.50, 0.44, 2)]
L8 = [(0.50, 0.50, -3), (0.28, 0.44, 7), (0.72, 0.56, -6), (0.38, 0.60, 4),
      (0.62, 0.40, -5), (0.24, 0.62, -8), (0.76, 0.40, 6), (0.50, 0.58, 2)]

SPEECH = dict(target=-19, duck=-11)                      # a line you said: clear over the music
REACT = dict(target=-19, duck=-7)                        # a quick reaction inside a fast section


def fr(clip, t):
    return ("frame", clip, t)


# Each shot may carry nat=dict(target dBFS, duck dB): its own sound is heard (shot must play at speed 1.0).
CHAPTERS = [
    {   # 1 · Lover Is A Day (unchanged except the orangutans are heard)
        "song": "lover", "anchor": 42.07, "begin_time": 0.0, "fade_out": 3.0,
        "shots": [
            dict(clip="river", tin=5.2, until=-52, text={"kind": "title", "t0": 1.4, "t1": 6.4}),
            dict(clip="orang", tin=7.3, y=0.85, b=8, text=cap("THE ZOO", "10:27 am")),
            dict(clip="orang", tin=15.3, y=0.3, speed=1.0, b=4, nat=dict(target=-19, duck=-10)),
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
    {   # 2 · Wolf Like Me: your line in the quiet, a build of accelerating cuts, then the aquarium at speed
        "song": "wolf", "anchor": 17.53, "begin": -16, "fade_in": 0.4, "fade_out": 0.35,
        "shots": [
            dict(clip="garden", tin=27.9, speed=1.0, sec=5.1, fx=["fade_in"], nat=dict(target=-18, duck=0),
                 text=dict(cap("BUTTERFLY GARDEN", "4:18 pm"), t0=0.6, t1=4.6)),
            # build: 4, 4, 2, 2, 1, 1, 1, 1 beats into the kick
            dict(clip="insect", tin=3.8, speed=1.0, b=4),
            dict(clip="atrium", tin=12.3, speed=1.0, b=4),
            dict(clip="insect", tin=18.9, speed=1.0, b=2),
            dict(clip="butterfly", tin=3.3, speed=1.0, b=2),
            dict(clip="insect", tin=41.5, speed=1.0, b=1),
            dict(clip="insect", tin=56.6, speed=1.0, b=1),
            dict(clip="atrium", tin=2.0, speed=1.0, b=1),
            dict(clip="butterfly", tin=8.0, speed=1.0, b=1),
            # the kick
            dict(clip="tunnel", tin=1.5, speed=1.0, b=4),
            dict(clip="tank", tin=11.0, speed=1.0, b=2),
            dict(clip="tunnel", tin=7.5, speed=1.0, b=2),
            dict(clip="gator", tin=1.5, speed=1.0, b=8, text=cap("AQUARIUM", "4:21 pm")),
            dict(clip="ray", tin=5.0, speed=1.0, b=4),
            dict(clip="ray", tin=11.8, speed=1.0, b=4, layout=L1, cards=[(14, 2)]),
            dict(clip="jungle", tin=9.5, speed=1.0, b=4),
            dict(clip="jungle", tin=20.8, speed=1.0, b=4),
            dict(clip="tank", tin=16.5, speed=1.0, b=16, layout=L6, until_card=14, cards=[
                (fr("river", 15.4), 0), (fr("garden", 35.4), 2), (fr("garden", 29.3), 4),
                (fr("tunnel", 22.4), 6), (20, 8), (fr("tank", 50.2), 10)]),
            dict(clip="vert", tin=1.0, fit="fill", speed=1.0, b=2),
            dict(clip="tunnel", tin=21.8, speed=1.0, b=2),
            dict(clip="rays2", tin=5.0, speed=1.0, b=2),
            dict(clip="tank", tin=38.0, speed=1.0, b=2),
            dict(clip="insect", tin=26.4, speed=1.0, b=2),
            dict(clip="gator", tin=43.6, speed=1.0, b=2),
            dict(clip="ray", tin=16.0, speed=1.0, b=2),
            dict(clip="jungle", tin=1.0, speed=1.0, b=2),
            dict(clip="tank", tin=12.9, speed=1.0, b=4, nat=REACT),
            dict(clip="tunnel", tin=13.0, speed=1.0, b=4),
            dict(clip="tank", tin=44.5, speed=1.0, b=8),
            dict(clip="jungle", tin=12.0, speed=1.0, b=16, layout=L8, until_card=10, cards=[
                (14, 0), (20, 1), (fr("vert", 2.0), 2), (fr("tunnel", 7.5), 3), (fr("ray", 13.0), 4),
                (fr("jungle", 1.5), 5), (fr("tank", 12.0), 6), (fr("garden", 33.0), 7)]),
            dict(clip="tunnel", tin=25.0, speed=1.0, b=2),
            dict(clip="vert", tin=20.0, fit="fill", speed=1.0, b=2),
            dict(clip="tank", tin=5.0, speed=1.0, b=2),
            dict(clip="rays2", tin=8.0, speed=1.0, b=2),
            dict(clip="ray", tin=2.0, speed=1.0, b=2),
            dict(clip="insect", tin=49.1, speed=1.0, b=2),
            dict(clip="insect", tin=71.7, speed=1.0, b=2),
            dict(clip="butterfly", tin=10.0, speed=1.0, b=2),
            dict(clip="tunnel", tin=31.0, speed=1.0, b=8),
            dict(clip="tank", tin=50.0, speed=1.0, b=8),
            dict(clip="gator", tin=20.0, speed=1.0, b=4),
            dict(clip="jungle", tin=22.0, speed=1.0, b=4),
            dict(clip="tunnel", tin=17.0, speed=1.0, b=4),
            dict(clip="vert", tin=27.0, fit="fill", speed=1.0, b=4),
            dict(clip="tank", tin=52.8, speed=1.0, b=12),
            dict(clip="tunnel", tin=33.5, speed=1.0, b=4, fx=["whip_out"]),
        ],
    },
    {   # 3 · Nonchalant: the mall and the light rooms, now with what you said in there
        "song": "nonchalant", "anchor": 40.68, "begin_time": 0.0,
        "fade_out_from_shot": 22, "fade_out": 2.2,
        "shots": [
            dict(clip="mall", tin=1.0, until=-63, fx=["whip_in"], text=dict(cap("THE MALL", "4:53 pm"), t0=0.6)),
            dict(clip="mall", tin=20.0, b=7),
            dict(clip="mall", tin=38.1, b=4),
            dict(clip="mall", tin=5.4, b=4),
            dict(photo=15, fit="fill", b=4, text=cap("LIGHT ROOMS", "6:11 pm")),
            dict(clip="bluetun", tin=23.2, s=0.85, speed=1.0, b=8, nat=SPEECH),
            dict(clip="color", tin=12.1, s=0.8, speed=1.0, b=4, nat=dict(target=-15, duck=-12)),
            dict(clip="color", tin=6.8, s=0.8, b=4, layout=L1, cards=[(16, 2)]),
            dict(photo=17, fit="fill", s=0.85, b=4),
            dict(clip="bluetun", tin=49.5, s=0.85, b=4),
            dict(clip="color", tin=28.3, s=0.8, b=4),
            dict(clip="mirror", tin=1.5, s=0.8, b=4),
            dict(clip="mirror", tin=33.5, s=0.8, b=4),
            dict(clip="mirror", tin=37.0, s=0.8, b=4),
            dict(clip="mirror", tin=15.9, s=0.8, speed=1.0, b=4, nat=dict(target=-19, duck=-4)),
            dict(clip="mirror", tin=19.6, s=0.8, b=8, layout=L4,
                 cards=[(18, 0), (19, 2), (fr("color", 12.3), 4), (fr("mirror", 40.4), 6)]),
            dict(clip="color", tin=9.6, s=0.8, b=4),
            dict(clip="mirror", tin=23.2, s=0.8, b=4),
            dict(clip="bluetun", tin=63.3, s=0.85, b=4),
            dict(clip="color", tin=15.0, s=0.8, b=4),
            dict(clip="mirror", tin=5.3, s=0.8, b=4),
            dict(clip="mirror", tin=40.4, s=0.8, b=4),
            # the crowd swells under the title card and carries into Dominos
            dict(black=True, sec=2.4, text={"kind": "card", "lines": ("SIBERIA", "9:02 pm"), "t0": 0.25, "t1": 2.25},
                 nat=dict(src="late2", tin=2.0, target=-21, duck=0, fin=0.8, extend=1.2, fout=1.0)),
        ],
    },
    {   # 4 · Dominos: his show, cut fast, with the crowd under it; then the day in photos, faster
        "song": "dominos", "anchor": 0.07, "begin_time": 0.0, "fade_out": 6.0, "tail_silence": 1.0,
        "pulse_beats": (0, 96, 4),
        "bed": dict(sources=[("late1", 1.0, 8.5), ("late2", 2.0, 6.0)], until_beat=96, target=-31),
        "shots": [
            dict(clip="gig_b", tin=5.5, y=0.33, speed=1.0, until=4),
            dict(clip="gig_a", tin=16.0, y=0.33, speed=1.0, b=2),
            dict(clip="late1", tin=2.0, y=0.30, speed=1.0, b=2),
            dict(clip="gig_b", tin=9.1, y=0.33, speed=1.0, b=4),
            dict(clip="gig_a", tin=2.8, y=0.33, speed=1.0, b=2),
            dict(clip="late1", tin=6.9, y=0.30, speed=1.0, b=2),
            dict(clip="gig_b", tin=11.5, y=0.33, speed=1.0, b=2),
            dict(clip="gig_a", tin=12.5, y=0.33, speed=1.0, b=2),
            dict(clip="late2", tin=1.8, y=0.30, speed=1.0, b=2),
            dict(clip="gig_b", tin=0.5, y=0.33, speed=1.0, b=2),
            dict(clip="gig_a", tin=8.0, y=0.33, speed=1.0, b=8, layout=L4, cards=[
                (fr("gig_b", 6.0), 0), (fr("gig_a", 16.5), 2), (fr("late1", 4.4), 4), (fr("gig_b", 10.5), 6)]),
            dict(clip="late2", tin=2.5, y=0.30, speed=1.0, b=8, text=cap("STILL OUT", "11:38 pm")),
            dict(clip="gig_b", tin=12.2, y=0.33, speed=1.0, b=2),
            dict(clip="gig_a", tin=10.4, y=0.33, speed=1.0, b=2),
            dict(clip="late1", tin=8.0, y=0.30, speed=1.0, b=2),
            dict(clip="gig_a", tin=18.0, y=0.33, speed=1.0, b=2),
            dict(clip="gig_b", tin=3.0, y=0.33, speed=1.0, b=2),
            dict(clip="gig_a", tin=6.0, y=0.33, speed=1.0, b=2),
            dict(clip="gig_b", tin=7.0, y=0.33, speed=1.0, b=2),
            dict(clip="late1", tin=0.5, y=0.30, speed=1.0, b=2),
            dict(clip="gig_a", tin=13.5, y=0.33, speed=1.0, b=1),
            dict(clip="gig_b", tin=13.0, y=0.33, speed=1.0, b=1),
            dict(clip="late2", tin=6.5, y=0.30, speed=1.0, b=1),
            dict(clip="gig_a", tin=21.0, y=0.33, speed=1.0, b=1),
            dict(clip="gig_a", tin=0.5, y=0.33, speed=1.0, b=4),
            dict(clip="gig_a", tin=15.0, y=0.33, speed=1.0, b=4),
            dict(clip="late1", tin=3.0, y=0.30, speed=1.0, b=4),
            dict(clip="gig_b", tin=10.0, y=0.33, speed=1.0, b=4),
            dict(clip="gig_a", tin=19.0, y=0.33, speed=1.0, b=4),
            dict(clip="gig_b", tin=5.0, y=0.33, speed=1.0, b=8),
            dict(clip="gig_a", tin=1.5, y=0.33, speed=1.0, b=4),
            dict(clip="late2", tin=7.0, y=0.30, speed=1.0, b=4),
            dict(clip="gig_a", tin=3.0, y=0.33, speed=1.0, b=32, dim="all", groups=[
                (L5, [(0, 0), (1, 2), (2, 4), (3, 6), (4, 8)], 10),
                (L3, [(5, 10), (6, 12), (7, 14)], 16),
                (L3, [(8, 16), (9, 17), (10, 18)], 20),
                (L3, [(11, 20), (12, 21), (13, 22)], 24),
                (L2, [(14, 24), (20, 25)], 26),
                (L5, [(15, 26), (16, 27), (17, 28), (18, 29), (19, 30)], 32),
            ]),
            dict(photo=7, y=0.55, b=16, fx=["fade_out"], text={"kind": "end", "t0": 0.7, "t1": 4.1}),
            dict(black=True, sec=1.0),
        ],
    },
]

RENDER_KEYS = ("clip", "photo", "black", "tin", "y", "speed", "fit", "fx", "g", "s")


def shot_key(s, nframes):
    """Only what changes the pixels of a shot; lets unchanged shots be reused from build2."""
    core = {k: s[k] for k in RENDER_KEYS if k in s}
    return hashlib.sha1(repr((sorted(core.items()), nframes)).encode()).hexdigest()[:16]


def seed_from_build2():
    """Link cut 2's rendered shots into this build's cache under their content keys."""
    os.makedirs(f"{B}/shots", exist_ok=True)
    for ci, ch in enumerate(b2.CHAPTERS, start=1):
        frames = b2.layout_chapter(ch)[3]
        for k, s in enumerate(ch["shots"]):
            src = f"{b2.B}/c{ci}_s{k:02d}.mp4"
            dst = f"{B}/shots/{shot_key(s, frames[k + 1] - frames[k])}.mp4"
            if os.path.exists(src) and not os.path.exists(dst):
                os.link(src, dst)


def render_shot(s, nframes):
    key = shot_key(s, nframes)
    out = f"{B}/shots/{key}.mp4"
    if os.path.exists(out):
        return out
    # build2.render_shot writes build2/c{ci}_s{k}.mp4; render under a scratch name, then move it here
    path = b2.render_shot(f"_tmp_{key}", 0, s, nframes)
    os.replace(path, out)
    if os.path.exists(path + ".sig"):
        os.remove(path + ".sig")
    return out


def layout(ch):
    """Local timeline of a chapter. Shots with sec before the beat grid starts are lead-ins (no music)."""
    g = b2.song_grid(ch["song"])
    a = int(np.argmin(abs(g - ch["anchor"])))
    lead = 0.0
    if "begin_time" in ch:
        t0, idx = ch["begin_time"], None
    else:
        t0, idx = float(g[a + ch["begin"]]), a + ch["begin"]
    local, idxs, started = [0.0], [], "begin_time" in ch
    for s in ch["shots"]:
        idxs.append(idx if started else None)
        if not started and "sec" in s:
            lead += s["sec"]
            local.append(lead)
            continue
        started = True
        if "until" in s:
            idx = a + s["until"]
        elif "b" in s:
            idx = idx + s["b"]
        else:
            idx = None
        local.append(float(g[idx]) - t0 + lead if idx is not None else local[-1] + s["sec"])
        if idxs[-1] is None and idx is not None and "b" in s:
            idxs[-1] = idx - s["b"]
    frames = [round(x * FPS) for x in local]
    return dict(t0=t0, lead=lead, idxs=idxs, frames=frames, beat_local=lambda i: float(g[i]) - t0 + lead)


def main():
    os.makedirs(f"{B}/shots", exist_ok=True)
    only = int(sys.argv[sys.argv.index("--only") + 1]) if "--only" in sys.argv else None
    plans = [layout(ch) for ch in CHAPTERS]
    for ci, (ch, p) in enumerate(zip(CHAPTERS, plans), start=1):
        fr_ = p["frames"]
        print(f"chapter {ci} · {ch['song']} from {p['t0']:.2f}s (music at +{p['lead']:.2f}s) · "
              f"{fr_[-1] / FPS:.2f}s · {len(ch['shots'])} shots")
        for k, s in enumerate(ch["shots"]):
            what = s.get("clip") or (f"photo {s['photo']}" if "photo" in s else "black")
            print(f"   {k:02d} {what:<10} {fr_[k] / FPS:7.2f} -> {fr_[k + 1] / FPS:7.2f}  ({(fr_[k + 1] - fr_[k]) / FPS:.2f}s)"
                  + ("  [sound]" if s.get("nat") else ""))
    total = sum(p["frames"][-1] for p in plans) / FPS
    print("total", round(total, 2))
    if "--plan" in sys.argv:
        return
    if "--audio-only" in sys.argv:  # re-mix the sound and swap it into the finished picture
        mix_and_encode(plans, [p["frames"][-1] / FPS for p in plans], None, f"{OUT}/new_orleans_cut3.mp4")
        return

    seed_from_build2()
    jobs = []
    for ci, (ch, p) in enumerate(zip(CHAPTERS, plans), start=1):
        if only and ci != only:
            continue
        for k, s in enumerate(ch["shots"]):
            jobs.append((ci, s, p["frames"][k + 1] - p["frames"][k]))
    with ThreadPoolExecutor(max_workers=3) as pool:
        files = list(pool.map(lambda j: render_shot(j[1], j[2]), jobs))
    by_ch = {}
    for (ci, *_), f in zip(jobs, files):
        by_ch.setdefault(ci, []).append(f)

    # composite each chapter with build2's layer code (cards, dimming, type, grain) plus the bar pulses
    chapters = []
    for ci, (ch, p) in enumerate(zip(CHAPTERS, plans), start=1):
        if only and ci != only:
            continue
        chapters.append(composite(ci, ch, by_ch[ci], p))
        print("chapter", ci, "composited", flush=True)
    if only:
        return
    mix_and_encode(plans, [d for _, d in chapters], [c for c, _ in chapters])


def composite(ci, ch, files, p):
    """build2.composite with this chapter's layers, plus a brightness pulse on the bar for the show."""
    shots = []
    for s in ch["shots"]:
        s = dict(s)
        if "until_card" in s:  # a card stack that clears before the shot ends
            s = dict(s, groups=[(s["layout"], s["cards"], s["until_card"])])
            s.pop("cards")
        shots.append(s)
    ch2 = dict(ch, shots=shots)
    saved_run, cmds = b2.run, []

    def capture(cmd):  # hold back only the chapter composite; stills for new cards still get made
        if "-filter_complex" in cmd and os.path.basename(cmd[-1]).startswith("chapter"):
            cmds.append(cmd)
        else:
            saved_run(cmd)

    b2.run = capture                          # capture build2's composite command, then add the pulses
    try:
        out, total = b2.composite(f"3_{ci}", ch2, files, p["frames"], p["idxs"], p["beat_local"])
    finally:
        b2.run = saved_run
    cmd = cmds[-1]
    out = f"{B}/chapter{ci}.mp4"
    cmd[-1] = out
    if ch.get("pulse_beats"):
        start, stop, step = ch["pulse_beats"]
        times = pulse_times(ch, p, start, stop, step)
        on = "+".join(f"between(t,{t:.3f},{t + 0.084:.3f})" for t in times)
        fc = cmd.index("-filter_complex") + 1
        cmd[fc] = cmd[fc].replace("[v0]", f",eq=brightness=0.09:enable='{on}'[v0]", 1)
    b2.run(cmd)
    return out, total


def pulse_times(ch, p, start, stop, step):
    g = b2.song_grid(ch["song"])
    a = int(np.argmin(abs(g - ch["anchor"])))
    return [p["beat_local"](a + k) for k in range(start, stop, step)]


def level_dbfs(wav, start, dur):
    """Loudness of the busy part of a stretch of audio (90th percentile of 100 ms RMS), in dBFS."""
    import soundfile as sf
    info = sf.info(wav)
    y, sr = sf.read(wav, start=int(start * info.samplerate), frames=int(dur * info.samplerate), always_2d=True)
    y = y.mean(axis=1)
    n = int(sr * 0.1)
    blocks = [y[i:i + n] for i in range(0, len(y) - n, n)] or [y]
    rms = np.array([np.sqrt(np.mean(b ** 2)) + 1e-9 for b in blocks])
    return float(20 * np.log10(np.percentile(rms, 90)))


def clip_wav(clip):
    os.makedirs(f"{B}/audio", exist_ok=True)
    out = f"{B}/audio/{clip}.wav"
    if not os.path.exists(out):
        b2.run(["ffmpeg", "-v", "error", "-y", "-i", f"{RAW}/{CLIP[clip]}", "-vn", "-ac", "2", "-ar", "48000", out])
    return out


def mix_and_encode(plans, durs, chapter_files, video_src=None):
    starts = np.concatenate([[0.0], np.cumsum(durs)])[:-1]
    total = float(sum(durs))
    inputs, graph, music_labels, nat_labels, ducks = [], [], [], [], []
    n_in = 1

    def add_input(path, ss=None, t=None):
        nonlocal n_in
        if ss is not None:
            inputs.extend(["-ss", f"{ss:.3f}", "-t", f"{t:.3f}"])
        inputs.extend(["-i", path])
        n_in += 1
        return n_in - 1

    # music: one song per chapter, levelled to -14 LUFS, placed where the chapter's beat grid starts
    for ci, (ch, p, dur, g0) in enumerate(zip(CHAPTERS, plans, durs, starts), start=1):
        path = f"{MUSIC}/{SONG[ch['song']][0]}"
        mdur = dur - p["lead"]
        gain = -14.0 - b2.loudness(path, p["t0"], mdur)
        k = add_input(path)
        f = [f"atrim=start={p['t0']:.3f}:duration={mdur:.3f}", "asetpts=PTS-STARTPTS",
             "aformat=sample_rates=48000:channel_layouts=stereo", f"volume={gain:.2f}dB"]
        if ch.get("fade_in"):
            f.append(f"afade=t=in:st=0:d={ch['fade_in']}")
        tail = ch.get("tail_silence", 0.0)
        if "fade_out_from_shot" in ch:
            st = p["frames"][ch["fade_out_from_shot"]] / FPS - p["lead"]
            f.append(f"afade=t=out:st={st:.3f}:d={ch['fade_out']}")
        elif ch.get("fade_out"):
            f.append(f"afade=t=out:st={mdur - tail - ch['fade_out']:.3f}:d={ch['fade_out']}")
        delay = int(round((g0 + p["lead"]) * 1000))
        f.append(f"adelay={delay}|{delay}")
        graph.append(f"[{k}:a]" + ",".join(f) + f"[m{ci}]")
        music_labels.append(f"[m{ci}]")
        print(f"chapter {ci} music gain {gain:+.1f} dB")

    # the day's own sound: each flagged shot plays its audio; the music ducks under it
    def add_nat(label, wav, tin, dur, at, target, fin, fout):
        k = add_input(wav, tin, dur)
        gain = target - level_dbfs(wav, tin, dur)
        d = int(round(at * 1000))
        graph.append(f"[{k}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={gain:.2f}dB,"
                     f"afade=t=in:st=0:d={fin},afade=t=out:st={max(0.0, dur - fout):.3f}:d={fout},"
                     f"adelay={d}|{d}[{label}]")
        nat_labels.append(f"[{label}]")

    for ci, (ch, p, g0) in enumerate(zip(CHAPTERS, plans, starts), start=1):
        for k, s in enumerate(ch["shots"]):
            nat = s.get("nat")
            if not nat:
                continue
            a, b = p["frames"][k] / FPS, p["frames"][k + 1] / FPS
            src = nat.get("src", s.get("clip"))
            tin = nat.get("tin", s.get("tin", 0.0))
            if "src" not in nat:
                assert s.get("speed") == 1.0, f"sound needs real-time playback: chapter {ci} shot {k}"
            dur = (b - a) + nat.get("extend", 0.0)
            fin, fout = nat.get("fin", 0.12), nat.get("fout", 0.3)
            add_nat(f"n{ci}_{k}", clip_wav(src), tin, dur, g0 + a, nat["target"], fin, fout)
            if nat.get("duck"):
                ducks.append((g0 + a + fin, g0 + a + dur - fout, 10 ** (nat["duck"] / 20)))
        bed = ch.get("bed")
        if bed:  # low crowd noise under the show, looped from the late-night crowd clips
            g = b2.song_grid(ch["song"])
            a_idx = int(np.argmin(abs(g - ch["anchor"])))
            end = p["beat_local"](a_idx + bed["until_beat"])
            t, i = 0.0, 0
            while t < end - 0.05:
                clip, tin, length = bed["sources"][i % len(bed["sources"])]
                seg = min(length, end - t + 0.3)
                add_nat(f"bed{ci}_{i}", clip_wav(clip), tin, seg, g0 + t, bed["target"], 0.3, 0.3)
                t += seg - 0.3
                i += 1

    graph.append("".join(music_labels) + f"amix=inputs={len(music_labels)}:normalize=0:duration=longest[mus]")
    if ducks:
        terms = [f"(1-{1 - g:.3f}*min(clip((t-{a - 0.25:.3f})/0.25,0,1),clip(({b + 0.25:.3f}-t)/0.25,0,1)))"
                 for a, b, g in ducks]
        graph.append(f"[mus]volume=volume='{'*'.join(terms)}':eval=frame[musd]")
    else:
        graph.append("[mus]anull[musd]")
    graph.append("".join(nat_labels) + f"amix=inputs={len(nat_labels)}:normalize=0:duration=longest[nat]")
    graph.append(f"[musd][nat]amix=inputs=2:normalize=0:duration=first,atrim=duration={total:.3f},"
                 "alimiter=limit=0.891:level=false[a]")

    if video_src:
        video_in, video_out = ["-i", video_src], ["-c:v", "copy"]
    else:
        with open(f"{B}/chapters.txt", "w") as f:
            f.writelines(f"file '{c}'\n" for c in chapter_files)
        video_in = ["-f", "concat", "-safe", "0", "-i", f"{B}/chapters.txt"]
        video_out = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "14M", "-bufsize", "28M",
                     "-profile:v", "high", "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709",
                     "-colorspace", "bt709", "-r", FPS_EXPR]
    tmp = f"{OUT}/new_orleans_cut3.tmp.mp4"
    b2.run(["ffmpeg", "-v", "error", "-y", *video_in, *inputs,
            "-filter_complex", ";".join(graph), "-map", "0:v", "-map", "[a]", *video_out,
            "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", tmp])
    os.replace(tmp, f"{OUT}/new_orleans_cut3.mp4")
    print("done", f"{OUT}/new_orleans_cut3.mp4", round(total, 2))


if __name__ == "__main__":
    main()
