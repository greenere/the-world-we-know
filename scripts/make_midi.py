"""Write the atlas's MIDI pieces from their transcriptions in data/scores/ into public/audio/midi/.

Each piece becomes a Standard MIDI File with one track per instrument, named for the member of the
tradition's ensemble that plays it (data/soundscapes.json), and markers the music can stop at: `cadence` at
the end of a line, `stanza` at the end of a stanza. The files open in any MIDI editor or notation program.

    python3 scripts/make_midi.py
"""

import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCORES = ROOT / "data" / "scores"
OUT = ROOT / "public" / "audio" / "midi"
TPQ = 480  # ticks per quarter; at 60 beats a minute a quarter is a second
LETTERS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi_of(note: str) -> int:
    m = re.fullmatch(r"([A-G])([#b]?)(-?\d)", note)
    if not m:
        raise ValueError(note)
    return 12 * (int(m.group(3)) + 1) + LETTERS[m.group(1)] + {"#": 1, "b": -1, "": 0}[m.group(2)]


def vlq(n: int) -> bytes:
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append(0x80 | (n & 0x7F))
        n >>= 7
    return bytes(reversed(out))


class Track:
    def __init__(self, name: str, channel: int):
        self.name = name
        self.channel = channel
        self.events: list[tuple[int, int, bytes]] = []  # (tick, order, data); note-offs sort before note-ons

    def note(self, at: float, dur: float, pitch: int, velocity: int):
        a, b = round(at * TPQ), round((at + dur) * TPQ)
        self.events.append((a, 1, bytes([0x90 | self.channel, pitch, velocity])))
        self.events.append((b, 0, bytes([0x80 | self.channel, pitch, 0])))

    def marker(self, at: float, text: str):
        t = text.encode()
        self.events.append((round(at * TPQ), 2, b"\xff\x06" + vlq(len(t)) + t))

    def chunk(self) -> bytes:
        name = self.name.encode()
        body = b"\x00\xff\x03" + vlq(len(name)) + name
        last = 0
        for tick, _, data in sorted(self.events, key=lambda e: (e[0], e[1])):
            body += vlq(tick - last) + data
            last = tick
        body += b"\x00\xff\x2f\x00"
        return b"MTrk" + struct.pack(">I", len(body)) + body


def write(path: Path, tracks: list[Track], bpm: float = 60):
    tempo = Track("tempo", 0)
    us = round(60_000_000 / bpm)
    tempo.events.append((0, 0, b"\xff\x51\x03" + us.to_bytes(3, "big")))
    data = b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks) + 1, TPQ) + tempo.chunk() + b"".join(t.chunk() for t in tracks)
    path.write_bytes(data)
    return len(data)


def confucius_hymn(score: dict) -> list[Track]:
    """The temple performance as Van Aalst describes it (p. 33), one syllable at a time: the bell-chime gives
    the note, the zithers answer, the winds and the six singers take it up, and the stone-chime closes it.
    The large bell opens each line; at the end of each stanza one drum is struck three times and another
    answers, the bell-chime gives the key-note, and the next stanza begins. The tiger-box ends the hymn.

    The hymn is moved up a fourth so that its final falls on the atlas's shared tonic, D: it was sung in a
    different key each month anyway, the key-note following the moon."""
    names = ["bianzhong", "qin", "se", "xiao", "dizi", "sheng", "voices", "bianqing", "tezhong", "drum", "drum2", "yu"]
    T = {n: Track(n, i if i < 9 else i + 1) for i, n in enumerate(names)}
    up = 5
    S = 2.6  # seconds to a syllable: "very slow"
    t = 1.0
    for si, stanza in enumerate(score["stanzas"]):
        for li, line in enumerate(stanza["lines"]):
            notes = [midi_of(tok[2:]) + up for tok in line.split()]
            T["tezhong"].note(t, 3.5, notes[0] - 24, 70)
            for k, p in enumerate(notes):
                at = t + k * S
                T["bianzhong"].note(at, 2.0, p, 78)
                T["qin"].note(at + 0.3, 2.0, p - 12, 82)
                T["se"].note(at + 0.36, 2.0, p - 24, 60)
                T["xiao"].note(at + 0.55, 1.65, p - 12, 64)
                T["dizi"].note(at + 0.57, 1.6, p, 48)
                T["sheng"].note(at + 0.55, 1.65, p - 12, 52)
                T["sheng"].note(at + 0.55, 1.65, p - 5, 40)
                T["voices"].note(at + 0.55, 1.75, p - 12, 84)
                T["bianqing"].note(at + 2.25, 0.4, p - 12, 70)
            t += 4 * S
            T["bianzhong"].marker(t, "cadence")
        # The drums between stanzas, then the bell-chime gives the key-note.
        T["bianzhong"].marker(t, "stanza")
        for k in range(3):
            T["drum"].note(t + 0.4 + k * 0.9, 0.3, 48, 100)
        for k in range(3):
            T["drum2"].note(t + 3.2 + k * 0.9, 0.3, 45, 90)
        t += 6.2
        if si < len(score["stanzas"]) - 1:
            T["bianzhong"].note(t, 2.2, midi_of("A4") + up, 74)
            t += 2.8
    T["yu"].note(t + 0.3, 1.6, 60, 90)
    T["bianzhong"].marker(t + 2.4, "end")
    return [T[n] for n in names]


def parse_notes(text: str, up: int) -> list[tuple[int | None, float, bool]]:
    """`pitch:beats` notation (the same as data/soundscapes.json's tunes): (MIDI pitch or None, beats, ends a phrase)."""
    out: list[tuple[int | None, float, bool]] = []
    for tok in text.split():
        if tok == "|":
            continue
        if tok == "/":
            if out:
                out[-1] = (out[-1][0], out[-1][1], True)
            continue
        pitch, beats = tok.split(":")
        out.append((None if pitch == "r" else midi_of(pitch) + up, float(beats), False))
    return out


def tracks(names: list[str]) -> dict[str, Track]:
    return {n: Track(n, i if i < 9 else i + 1) for i, n in enumerate(names)}


def guiding_march(score: dict) -> list[Track]:
    """Van Aalst's band (p. 26): two each of sheng, di, xiao, yunluo gong-chimes, tou-kuan double reeds, drums
    and castanets, all on the one tune, the reeds and flutes a little apart, the gongs and drums on the beats.
    Played three times, the flutes leaping an octave the second time. Moved down a minor third, so that its
    final falls on D."""
    T = tracks(["guanzi", "dizi", "xiao", "sheng", "yunluo", "drum", "clapper"])
    beat = 0.78
    notes = parse_notes(score["notes"], -3)
    t = 0.6
    for rep in range(3):
        b = 0.0
        for pitch, beats, end in notes:
            at = t + b * beat
            dur = beats * beat * 0.94
            if pitch is not None:
                T["guanzi"].note(at, dur, pitch, 84)
                T["dizi"].note(at + 0.01, dur, pitch + (24 if rep == 1 else 12), 60)
                T["xiao"].note(at + 0.02, dur, pitch, 54)
                T["sheng"].note(at, dur, pitch, 50)
                T["sheng"].note(at, dur, pitch + 7, 38)
                if abs(b - round(b)) < 1e-6 and round(b) % 2 == 0:
                    T["yunluo"].note(at, 1.0, pitch + 12, 62)
            if end:
                T["guanzi"].marker(at + beats * beat, "cadence")
            b += beats
        # The drums and castanets keep the march's slow step: drum on the first beat, castanets on the third.
        for k in range(int(b)):
            at = t + k * beat
            if k % 4 == 0:
                T["drum"].note(at, 0.3, 48, 96)
            elif k % 4 == 2:
                T["clapper"].note(at, 0.2, 76, 90)
        t += b * beat + beat
        T["guanzi"].marker(t, "stanza")
    return list(T.values())


def madame_wang(score: dict) -> list[Track]:
    """A popular song as the street and the teahouse played it: the pipa, trembling its long notes, the huqin
    shadowing it, the di an octave up, the clapper on each downbeat and a wood block between. Twice through,
    the di joining the second time. Moved down a tone, so that its final falls on D."""
    T = tracks(["pipa", "huqin", "dizi", "clapper", "woodblock"])
    beat = 0.46
    notes = parse_notes(score["notes"], -2)
    t = 0.5
    for rep in range(2):
        b = 0.0
        for pitch, beats, end in notes:
            at = t + b * beat
            dur = beats * beat * 0.95
            if pitch is not None:
                T["pipa"].note(at, dur, pitch, 92)
                T["huqin"].note(at + 0.03, dur, pitch, 66)
                if rep == 1:
                    T["dizi"].note(at, dur, pitch + 12, 50)
            if end:
                T["pipa"].marker(at + beats * beat, "cadence")
            b += beats
        for k in range(int(b)):
            at = t + k * beat
            (T["clapper"] if k % 2 == 0 else T["woodblock"]).note(at, 0.15, 76, 80 if k % 2 == 0 else 55)
        t += b * beat + beat * 2
        T["pipa"].marker(t, "stanza")
    return list(T.values())


def molihua(score: dict) -> list[Track]:
    """The song as a street band of the nineteenth century would play it at a wedding: the suona on the tune,
    the sheng beneath it, drum and small cymbals on the beats and a gong at the end of each phrase. Twice
    through. Moved up a tone, so that its tonic falls on D."""
    T = tracks(["suona", "sheng", "drum", "cymbals", "gong"])
    beat = 0.5
    notes = parse_notes(score["notes"], 2)
    t = 0.5
    for rep in range(2):
        b = 0.0
        for pitch, beats, end in notes:
            at = t + b * beat
            dur = beats * beat * 0.92
            if pitch is not None:
                T["suona"].note(at, dur, pitch + 12, 88)
                T["sheng"].note(at, dur, pitch, 46)
                T["sheng"].note(at, dur, pitch + 7, 36)
            if end:
                T["gong"].note(at + beats * beat - 0.05, 2.5, 38, 70)
                T["suona"].marker(at + beats * beat, "cadence")
            b += beats
        for k in range(int(b)):
            at = t + k * beat
            if k % 2 == 0:
                T["drum"].note(at, 0.2, 48, 84)
            T["cymbals"].note(at + (beat / 2 if k % 2 else 0), 0.2, 80, 50)
        t += b * beat + beat * 2
        T["suona"].marker(t, "stanza")
    return list(T.values())


PIECES = {"confucius-hymn": confucius_hymn, "guiding-march": guiding_march, "madame-wang": madame_wang, "molihua": molihua}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, arrange in PIECES.items():
        score = json.loads((SCORES / f"{name}.json").read_text(encoding="utf-8"))
        size = write(OUT / f"{name}.mid", arrange(score))
        print(f"  {name}.mid: {size / 1000:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
