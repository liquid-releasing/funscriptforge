"""Velocity-vs-boundary probe (v3 — per-chapter relative, heat-digit render).

The phrase heat ribbon normalizes stroke velocity to a LOCAL max, so "orange"
means fast *relative to this chapter*. This probe:
  - computes per-window (3s/1.5s) mean stroke velocity within each chapter
  - normalizes to that chapter's own velocity scale (p95) -> 0..9 heat digit
  - flags SUSTAINED calm->loud seams: a run of >=MIN_RUN low windows
    immediately followed by >=MIN_RUN high windows (low<LO, high>HI on the
    0..1 local scale), and reports which are NOT already phrase boundaries.
Read-only.
"""
import json, sys, collections

BASE = r"c:/Users/bruce/Projects/_lqr/forgeassembler/test_media/ipzz125"
STEM = "IPZZ-125.molester.omfg_iris3"
FORGE = f"{BASE}/.{STEM}.forge"
FUNSCRIPT = f"{BASE}/{STEM}.funscript"
PHRASES = f"{FORGE}/{STEM}.phrases.json"

WINDOW_MS = 3000
HOP_MS = 1500
LO = 0.33       # local-scale below this = calm/blue
HI = 0.60       # local-scale above this = loud/orange
MIN_RUN = 3     # ~5-7s sustained

def load_actions():
    d = json.load(open(FUNSCRIPT, encoding="utf-8"))
    acts = d.get("actions", d) if isinstance(d, dict) else d
    return sorted(({"at": int(a["at"]), "pos": int(a["pos"])} for a in acts), key=lambda a: a["at"])

def seg_vels(actions):
    out = []
    for i in range(1, len(actions)):
        dt = max(1, actions[i]["at"] - actions[i-1]["at"])
        out.append((actions[i]["at"], abs(actions[i]["pos"] - actions[i-1]["pos"]) / dt))
    return out

def win_means(vels, start, end):
    out = []
    t = start
    while t + WINDOW_MS <= end:
        v = [s for (at, s) in vels if t <= at < t + WINDOW_MS]
        if v: out.append((t + WINDOW_MS//2, sum(v)/len(v)))
        t += HOP_MS
    return out

def fmt(ms):
    s = ms/1000.0
    return f"{int(s//60)}:{s%60:05.2f}"

def runs(states):
    out = []
    for i, s in enumerate(states):
        if out and out[-1][0] == s: out[-1][2] = i
        else: out.append([s, i, i])
    return out

def main():
    chapters_wanted = [int(x) for x in (sys.argv[1:] or [1,6,10,14])]
    actions = load_actions()
    vels = seg_vels(actions)
    ph = json.load(open(PHRASES, encoding="utf-8"))["slices"]
    by_ch = collections.defaultdict(list)
    for p in ph: by_ch[p.get("chapter_id")].append(p)

    for cid in chapters_wanted:
        phr = sorted(by_ch.get(cid, []), key=lambda p: p["at_ms"])
        if not phr:
            print(f"== chapter {cid}: no phrases ==\n"); continue
        c0, c1 = phr[0]["at_ms"], phr[-1]["end_ms"]
        bnds = sorted({p["at_ms"] for p in phr} | {p["end_ms"] for p in phr})
        interior = [b for b in bnds if c0 < b < c1]
        wins = win_means(vels, c0, c1)
        if not wins: print(f"== chapter {cid}: no windows ==\n"); continue
        vs = sorted(w[1] for w in wins)
        scale = vs[int(0.95*(len(vs)-1))] or 1.0     # chapter p95 = local "max"
        norm = [(cms, min(1.0, v/scale)) for cms, v in wins]
        heat = "".join(str(min(9, int(t*10))) for _, t in norm)
        # boundary tick row aligned under heat
        tick = []
        for cms, _ in norm:
            tick.append('^' if any(abs(b-cms) <= HOP_MS for b in interior) else ' ')
        states = ['b' if t < LO else ('O' if t > HI else '.') for _, t in norm]
        seams = []
        r = runs(states)
        for k in range(1, len(r)):
            a, b = r[k-1], r[k]
            if {a[0], b[0]} == {'b','O'} and (a[2]-a[1]+1) >= MIN_RUN and (b[2]-b[1]+1) >= MIN_RUN:
                seam_ms = (norm[a[2]][0] + norm[b[1]][0])//2
                new = not any(abs(bb-seam_ms) <= HOP_MS for bb in bnds)
                seams.append((seam_ms, f"{a[0]}{a[2]-a[1]+1}->{b[0]}{b[2]-b[1]+1}", new))
        newn = sum(1 for *_, n in seams if n)
        print(f"== chapter {cid}  {fmt(c0)}-{fmt(c1)}  {len(phr)} phrases / {len(interior)} interior bnds  "
              f"(local p95 vel={scale:.3f} u/ms) ==")
        print("  heat " + heat)
        print("  bnds " + "".join(tick))
        print(f"  sustained calm<->loud seams: {len(seams)}  ({newn} not already a boundary)")
        for sms, why, n in seams:
            print(f"      {'+NEW' if n else '  ok'} {fmt(sms)}  {why}")
        print()

if __name__ == "__main__":
    main()
