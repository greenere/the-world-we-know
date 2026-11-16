"""Fetch the sampled instruments the atlas's music is played on, into public/audio/.

The samples are single notes rendered from the FluidR3 General MIDI soundfont by the MIDI.js soundfonts
project (https://github.com/gleitz/midi-js-soundfonts), released under Creative Commons Attribution 3.0.
Only one note in every minor third is kept; the browser bends each by at most a semitone and a half to play
the notes between. Writes public/audio/samples.json, which the app reads to know what it has.

    uv run --project scripts python scripts/fetch_samples.py
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "audio"
BASE = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM"
NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# The atlas's name for each instrument: the General MIDI patch it is drawn from, its lowest and highest notes
# (MIDI numbers), whether it holds a note (and so is cut at the note's end) or rings on, and its level.
INSTRUMENTS = {
    # Rome: the kithara (a harp is the nearest), the tibia or aulos (a double reed), the water organ.
    "harp": {"patch": "orchestral_harp", "low": 43, "high": 86, "held": False, "gain": 1.0},
    "oboe": {"patch": "oboe", "low": 58, "high": 88, "held": True, "gain": 0.7},
    "organ": {"patch": "church_organ", "low": 43, "high": 84, "held": True, "gain": 0.45},
    # China: the qin (the koto is its nearest kin in the set), the pipa (the shamisen, plucked bright and
    # dry), the xiao (the shakuhachi, an end-blown bamboo flute) and the huqin fiddle.
    "koto": {"patch": "koto", "low": 43, "high": 86, "held": False, "gain": 1.0},
    "shamisen": {"patch": "shamisen", "low": 50, "high": 86, "held": False, "gain": 0.8},
    "shakuhachi": {"patch": "shakuhachi", "low": 60, "high": 93, "held": True, "gain": 0.75},
    "fiddle": {"patch": "fiddle", "low": 55, "high": 88, "held": True, "gain": 0.6},
    # The Confucian temple: the six singers (a choir sings "ah"), the di flute, and the sheng mouth organ
    # (the reed organ is its nearest relative in the set: free reeds, steady and bright).
    "choir": {"patch": "choir_aahs", "low": 45, "high": 76, "held": True, "gain": 0.7},
    "dizi": {"patch": "flute", "low": 60, "high": 93, "held": True, "gain": 0.55},
    "sheng": {"patch": "reed_organ", "low": 55, "high": 84, "held": True, "gain": 0.4},
    # The suona, the "shrieking clarionet" of weddings and funerals: the shehnai is its cousin in the set.
    "suona": {"patch": "shanai", "low": 58, "high": 88, "held": True, "gain": 0.5},
    # The xun, the clay vessel flute of the Shang and Zhou (the ocarina is its kin), and the yangqin, the
    # hammered dulcimer that came to China in the Ming and is everywhere in its twentieth-century music.
    "xun": {"patch": "ocarina", "low": 55, "high": 81, "held": True, "gain": 0.6},
    "yangqin": {"patch": "dulcimer", "low": 48, "high": 88, "held": False, "gain": 0.7},
    # The atlas's own orchestra, which arranges every tradition's pieces for a modern ear (as a game's score
    # would): a string section for the harmony, cellos and basses beneath it, horns, and timpani and a great
    # drum for the swells. Not historical; the Historical setting leaves them out.
    "strings": {"patch": "string_ensemble_1", "low": 40, "high": 84, "held": True, "gain": 0.55},
    "cello": {"patch": "cello", "low": 36, "high": 69, "held": True, "gain": 0.6},
    "contrabass": {"patch": "contrabass", "low": 28, "high": 52, "held": True, "gain": 0.7},
    "horn": {"patch": "french_horn", "low": 41, "high": 77, "held": True, "gain": 0.45},
    "timpani": {"patch": "timpani", "low": 38, "high": 56, "held": False, "gain": 0.8},
    "taiko": {"patch": "taiko_drum", "low": 36, "high": 48, "held": False, "gain": 0.8},
}


def name(midi: int) -> str:
    return f"{NAMES[midi % 12]}{midi // 12 - 1}"


def fetch(url: str, tries: int = 6) -> bytes:
    """Download, waiting and trying again when the host is busy."""
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; sample-fetch/0.1)"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code < 500 or k == tries - 1:
                raise
            time.sleep(2 * (k + 1))
    raise RuntimeError(url)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {
        "credit": "Instrument samples: FluidR3 GM soundfont (Frank Wen), rendered by the MIDI.js soundfonts project, CC BY 3.0.",
        "instruments": {},
    }
    for key, spec in INSTRUMENTS.items():
        folder = OUT / key
        folder.mkdir(exist_ok=True)
        notes = list(range(spec["low"], spec["high"] + 1, 3))
        if notes[-1] != spec["high"]:
            notes.append(spec["high"])
        for m in notes:
            path = folder / f"{name(m)}.mp3"
            if path.exists() and path.stat().st_size > 0:
                continue
            url = f"{BASE}/{spec['patch']}-mp3/{name(m)}.mp3"
            data = fetch(url)
            if not data.startswith((b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")):
                print(f"  ! {url} is not an mp3", file=sys.stderr)
                return 1
            path.write_bytes(data)
            time.sleep(0.15)
        manifest["instruments"][key] = {
            "notes": [m for m in notes],
            "held": spec["held"],
            "gain": spec["gain"],
        }
        print(f"  {key}: {len(notes)} notes from {spec['patch']}")
    (OUT / "samples.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    size = sum(p.stat().st_size for p in OUT.rglob("*.mp3"))
    print(f"✓ {size / 1e6:.1f} MB of samples in public/audio")
    return 0


if __name__ == "__main__":
    sys.exit(main())
