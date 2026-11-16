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


# The atlas's orchestra: an arrangement for a modern ear beneath the historical players, as a game's score
# sets a folk tune over strings and horns. It harmonises a piece with the piece's own notes only (so a
# pentatonic tune keeps its colour: no note it does not use is added), one chord to each window of time,
# and voices that chord for strings, cellos and basses, a harp, horns and timpani. `level` says how much of
# the orchestra plays: 0 none, 1 a quiet string pad and cellos, 2 adds the harp and the basses, 3 the horns
# and the timpani, 4 everything at full voice.

ORCHESTRA = ["strings", "cello", "contrabass", "harp", "horn", "timpani", "taiko"]


def chord_for(weights: dict[int, float], scale: set[int], tonic: int, history: list[int], close: int | None) -> tuple[int, list[int]]:
    """The chord (root and pitch classes) that best carries a window's melody, from the scale's own notes.
    `close` is the pitch class a phrase ends on in this window, if one does: the chord gathers to it."""
    total = sum(weights.values()) or 1
    best = None
    for root in scale:
        if (root + 7) % 12 not in scale:
            continue
        third = next((root + i for i in (4, 3) if (root + i) % 12 in scale), None)
        tones = [root, third if third is not None else next((root + i for i in (2, 5) if (root + i) % 12 in scale), root), root + 7]
        colour = next((root + i for i in (9, 2, 10) if (root + i) % 12 in scale and (root + i) % 12 not in {t % 12 for t in tones}), None)
        pcs = {t % 12 for t in tones}
        score = sum(w for pc, w in weights.items() if pc in pcs) / total
        score -= 1.2 * sum(w for pc, w in weights.items() if any((pc - t) % 12 in (1, 11) for t in pcs)) / total
        if close is not None:
            score += 0.45 if root == close == tonic else 0.25 if root == close else 0.1 if close in pcs else -0.2
        if root == tonic:
            score += 0.08
        if third is None:
            score -= 0.08
        # Keep it moving: the same chord a third time running loses its pull.
        if history[-2:] == [root, root]:
            score -= 0.3
        elif history[-1:] == [root]:
            score += 0.05
        if best is None or score > best[0]:
            best = (score, root, [t % 12 for t in tones] + ([colour % 12] if colour is not None else []))
    assert best, "no chord fits"
    return best[1], best[2]


def nearest(pc: int, near: float, low: int, high: int) -> int:
    cands = [p for p in range(low, high + 1) if p % 12 == pc]
    return min(cands, key=lambda p: abs(p - near))


def orchestra(T: dict[str, Track], melody: list[tuple[float, float, int]], windows: list[tuple[float, float, float, bool]], *, beat: float, top: int, tonic: int = 2, swell_in: float = 0.0, taiko: bool = False):
    """Arrange `melody` (start, length, pitch) for the orchestra in `windows` (start, end, level, closes a
    phrase). The string chords stay below `top`, so the historical players carry the tune above them."""
    scale = {p % 12 for _, _, p in melody}
    history: list[int] = []
    voicing: list[int] = [50, 57, 62, 66]
    horn = 60
    for k, (a, b, level, closing) in enumerate(windows):
        if level <= 0:
            continue
        weights: dict[int, float] = {}
        for at, dur, p in melody:
            o = min(b, at + dur) - max(a, at)
            if o > 0:
                weights[p % 12] = weights.get(p % 12, 0) + o * (1.5 if abs(at - a) < 1e-3 else 1)
        if not weights:
            continue
        close = None
        if closing:
            last = [p for at, dur, p in melody if a <= at < b]
            close = last[-1] % 12 if last else None
        root, pcs = chord_for(weights, scale, tonic, history, close)
        span = b - a
        v = min(1.0, 0.45 + 0.14 * level)
        # Strings: the chord spread below the tune, each voice moving as little as it can.
        new = []
        for i, pc in enumerate(pcs[:4]):
            new.append(nearest(pc, voicing[i] if i < len(voicing) else voicing[-1] + 4, top - 22, top - 2))
        new = sorted(set(new))
        for p in new:
            T["strings"].note(a + 0.02, span - 0.04, p, round(46 * v + 8 * (level - 1)))
        voicing = new + [new[-1]] * (4 - len(new))
        # Cellos on the root; basses an octave under from level 2.
        T["cello"].note(a, span - 0.03, nearest(root, 45, 38, 52), round(60 * v))
        if level >= 2:
            T["contrabass"].note(a, span - 0.03, nearest(root, 36, 28, 43), round(66 * v))
            # The harp rolls the chord up through two octaves, one note to each half beat.
            notes = sorted({nearest(pc, 55 + 4 * i, 48, 76) for i, pc in enumerate(pcs)})
            notes += [n + 12 for n in notes if n + 12 <= 84]
            step = beat / 2 if beat < 1.2 else beat / 3
            t, i = a, 0
            while t < b - 0.01 and i < 16:
                T["harp"].note(t, step * 2, notes[i % len(notes)], round(58 * v))
                t += step
                i += 1
        if level >= 3:
            # Horns: one warm line on the chord's third or fifth, swelling.
            horn = nearest(pcs[1] if abs(nearest(pcs[1], horn, 53, 67) - horn) <= abs(nearest(pcs[2], horn, 53, 67) - horn) else pcs[2], horn, 53, 67)
            T["horn"].note(a + 0.05, span - 0.1, horn, round(62 * v + 6 * (level - 3)))
        if level >= 3 and closing:
            # The timpani roll into the phrase's close and strike its last chord.
            n = int(min(span, 2.2) / 0.11)
            for j in range(n):
                T["timpani"].note(b - n * 0.11 + j * 0.11, 0.1, nearest(tonic, 40, 38, 50), round(22 + 50 * j / n))
        if level >= 3 and taiko:
            for j in range(int(span / beat + 1e-6)):
                if j % 2 == 0:
                    T["taiko"].note(a + j * beat, 0.4, 41, 70 if j == 0 else 52)
        history.append(root)
    if swell_in:
        T["timpani"].note(swell_in, 0.6, nearest(tonic, 40, 38, 50), 90)


def windows_of(start: float, total: float, size: float, ends: list[float], levels) -> list[tuple[float, float, float, bool]]:
    """Windows of `size` seconds from `start`, each with its level (`levels(t)`) and whether a phrase ends in it."""
    out = []
    t = start
    while t < start + total - 1e-6:
        b = min(start + total, t + size)
        out.append((t, b, levels(t), any(t < e <= b + 1e-6 for e in ends)))
        t = b
    return out


def confucius_hymn(score: dict) -> list[Track]:
    """The temple performance as Van Aalst describes it (p. 33), one syllable at a time: the bell-chime gives
    the note, the zithers answer, the winds and the six singers take it up, and the stone-chime closes it.
    The large bell opens each line; at the end of each stanza one drum is struck three times and another
    answers, the bell-chime gives the key-note, and the next stanza begins. The tiger-box ends the hymn.

    The hymn is moved up a fourth so that its final falls on the atlas's shared tonic, D: it was sung in a
    different key each month anyway, the key-note following the moon."""
    names = ["bianzhong", "qin", "se", "xiao", "dizi", "sheng", "voices", "bianqing", "tezhong", "drum", "drum2", "yu"]
    T = tracks(names + ORCHESTRA)
    melody: list[tuple[float, float, int]] = []
    wins: list[tuple[float, float, float, bool]] = []
    # The orchestra grows through the hymn and falls back for its last stanza.
    stanza_level = [1, 2, 2, 3, 3, 2]
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
                melody.append((at, S, p))
            wins += [(t, t + 2 * S, stanza_level[si], False), (t + 2 * S, t + 4 * S, stanza_level[si], True)]
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
    orchestra(T, melody, wins, beat=S, top=68)
    return list(T.values())


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


CHANNELS = [c for c in range(16) if c != 9]


def tracks(names: list[str]) -> dict[str, Track]:
    return {n: Track(n, CHANNELS[i % len(CHANNELS)]) for i, n in enumerate(names)}


def guiding_march(score: dict) -> list[Track]:
    """Van Aalst's band (p. 26): two each of sheng, di, xiao, yunluo gong-chimes, tou-kuan double reeds, drums
    and castanets, all on the one tune, the reeds and flutes a little apart, the gongs and drums on the beats.
    Played three times, the flutes leaping an octave the second time. Moved down a minor third, so that its
    final falls on D."""
    T = tracks(["guanzi", "dizi", "xiao", "sheng", "yunluo", "drum", "clapper"] + ORCHESTRA)
    beat = 0.78
    notes = parse_notes(score["notes"], -3)
    t = 0.6
    for rep in range(3):
        b = 0.0
        melody: list[tuple[float, float, int]] = []
        ends: list[float] = []
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
                melody.append((at, beats * beat, pitch))
            if end:
                T["guanzi"].marker(at + beats * beat, "cadence")
                ends.append(at + beats * beat)
            b += beats
        # The drums and castanets keep the march's slow step: drum on the first beat, castanets on the third.
        for k in range(int(b)):
            at = t + k * beat
            if k % 4 == 0:
                T["drum"].note(at, 0.3, 48, 96)
            elif k % 4 == 2:
                T["clapper"].note(at, 0.2, 76, 90)
        # The procession gathers: strings alone the first time, the full orchestra and great drums the third.
        orchestra(T, melody, windows_of(t, b * beat, 4 * beat, ends, lambda _: rep + 1.5), beat=beat, top=70, taiko=rep == 2, swell_in=t if rep == 2 else 0)
        t += b * beat + beat
        T["guanzi"].marker(t, "stanza")
    return list(T.values())


def madame_wang(score: dict) -> list[Track]:
    """A popular song as the street and the teahouse played it: the pipa, trembling its long notes, the huqin
    shadowing it, the di an octave up, the clapper on each downbeat and a wood block between. Twice through,
    the di joining the second time. Moved down a tone, so that its final falls on D."""
    T = tracks(["pipa", "huqin", "dizi", "clapper", "woodblock"] + ORCHESTRA)
    beat = 0.46
    notes = parse_notes(score["notes"], -2)
    t = 0.5
    for rep in range(2):
        b = 0.0
        melody: list[tuple[float, float, int]] = []
        ends: list[float] = []
        for pitch, beats, end in notes:
            at = t + b * beat
            dur = beats * beat * 0.95
            if pitch is not None:
                T["pipa"].note(at, dur, pitch, 92)
                T["huqin"].note(at + 0.03, dur, pitch, 66)
                if rep == 1:
                    T["dizi"].note(at, dur, pitch + 12, 50)
                melody.append((at, beats * beat, pitch))
            if end:
                T["pipa"].marker(at + beats * beat, "cadence")
                ends.append(at + beats * beat)
            b += beats
        for k in range(int(b)):
            at = t + k * beat
            (T["clapper"] if k % 2 == 0 else T["woodblock"]).note(at, 0.15, 76, 80 if k % 2 == 0 else 55)
        # A teahouse song stays intimate: strings and harp beneath it, the horns only the second time.
        orchestra(T, melody, windows_of(t, b * beat, 4 * beat, ends, lambda _: 2 + rep), beat=beat, top=66)
        t += b * beat + beat * 2
        T["pipa"].marker(t, "stanza")
    return list(T.values())


def molihua(score: dict) -> list[Track]:
    """The song as a street band of the nineteenth century would play it at a wedding: the suona on the tune,
    the sheng beneath it, drum and small cymbals on the beats and a gong at the end of each phrase. Twice
    through. Moved up a tone, so that its tonic falls on D."""
    T = tracks(["suona", "sheng", "drum", "cymbals", "gong"] + ORCHESTRA)
    beat = 0.5
    notes = parse_notes(score["notes"], 2)
    t = 0.5
    for rep in range(2):
        b = 0.0
        melody: list[tuple[float, float, int]] = []
        ends: list[float] = []
        for pitch, beats, end in notes:
            at = t + b * beat
            dur = beats * beat * 0.92
            if pitch is not None:
                T["suona"].note(at, dur, pitch + 12, 88)
                T["sheng"].note(at, dur, pitch, 46)
                T["sheng"].note(at, dur, pitch + 7, 36)
                melody.append((at, beats * beat, pitch))
            if end:
                T["gong"].note(at + beats * beat - 0.05, 2.5, 38, 70)
                T["suona"].marker(at + beats * beat, "cadence")
                ends.append(at + beats * beat)
            b += beats
        for k in range(int(b)):
            at = t + k * beat
            if k % 2 == 0:
                T["drum"].note(at, 0.2, 48, 84)
            T["cymbals"].note(at + (beat / 2 if k % 2 else 0), 0.2, 80, 50)
        # The nineteenth century's song gets the whole orchestra, building to full voice the second time.
        orchestra(T, melody, windows_of(t, b * beat, 4 * beat, ends, lambda _: 3 + rep), beat=beat, top=72, swell_in=t if rep == 1 else 0)
        t += b * beat + beat * 2
        T["suona"].marker(t, "stanza")
    return list(T.values())


def guanju(score: dict) -> list[Track]:
    """The ode as the Zhou court might have sung it, one note to each syllable and slow: the xun alone first,
    then the singers with the se plucking beneath them, then the whole ritual band (the bell-chime giving
    each note, the stone-chime closing each line, the great bell opening it), and the xun alone again to
    close. The orchestra stays far back: a breath of strings, never more than the pad and the harp."""
    T = tracks(["xun", "voices", "se", "bianzhong", "bianqing", "tezhong", "sheng", "drum", "yu"] + ORCHESTRA)
    notes = parse_notes(score["notes"], 0)
    t = 1.0
    plan = [(1.6, 0), (1.5, 1), (1.4, 2), (1.75, 1)]  # seconds a syllable, orchestra level, each time through
    for rep, (S, level) in enumerate(plan):
        melody: list[tuple[float, float, int]] = []
        wins: list[tuple[float, float, float, bool]] = []
        line_start = t
        for k, (p, beats, end) in enumerate(notes):
            at = t + k * S
            first = k % 4 == 0
            if rep in (0, 3):
                T["xun"].note(at, S * 0.92, p + 12, 70 if rep == 0 else 58)
                if first:
                    T["drum"].note(at, 0.3, 45, 60)
            elif rep == 1:
                T["voices"].note(at, S * 0.95, p, 80)
                T["se"].note(at + 0.04, S, p - 12, 66)
                T["xun"].note(at + 0.35, S * 0.6, p + 12, 34)
            else:
                if first:
                    T["tezhong"].note(at, 3.0, p - 24, 70)
                T["bianzhong"].note(at, 1.6, p + 12, 74)
                T["se"].note(at + 0.25, S, p - 12, 70)
                T["voices"].note(at + 0.4, S * 0.85, p, 84)
                T["xun"].note(at + 0.42, S * 0.8, p + 12, 52)
                T["sheng"].note(at + 0.4, S * 0.85, p, 40)
                T["sheng"].note(at + 0.4, S * 0.85, p + 7, 30)
            melody.append((at, S, p))
            if end:
                T["bianqing"].note(at + S * 0.7, 0.4, p, 64 if rep else 50)
                T["xun"].marker(at + S, "cadence")
                wins += [(line_start, line_start + 2 * S, level, False), (line_start + 2 * S, at + S, level, True)]
                line_start = at + S
        t += len(notes) * S
        orchestra(T, melody, wins, beat=S, top=64)
        # Between the verses the drum is struck three times, as in the temple.
        for k in range(3):
            T["drum"].note(t + 0.5 + k * 0.8, 0.3, 48, 70 + 8 * k)
        t += 3.2
        T["xun"].marker(t, "stanza")
    T["yu"].note(t, 1.6, 60, 80)
    T["xun"].marker(t + 2.0, "end")
    return list(T.values())


def mama_hao_mingbai(score: dict) -> list[Track]:
    """A popular air of North China set as a twentieth-century Chinese orchestra might: the erhu (the huqin)
    sings it first over the yangqin and a quiet string section, the di takes it up an octave higher the
    second time with the horns beneath, and the third time everyone plays, the strings doubling the erhu,
    the timpani rolling it home."""
    T = tracks(["huqin", "dizi", "yangqin", "pipa", "woodblock"] + ORCHESTRA)
    beat = 0.5
    notes = parse_notes(score["notes"], 0)
    t = 0.6
    for rep, level in enumerate([2, 3, 4]):
        b = 0.0
        melody: list[tuple[float, float, int]] = []
        ends: list[float] = []
        for pitch, beats, end in notes:
            at = t + b * beat
            dur = beats * beat * 0.96
            if pitch is not None:
                T["huqin"].note(at, dur, pitch, 88 if rep != 1 else 64)
                if rep >= 1:
                    T["dizi"].note(at, dur, pitch + 12, 70 if rep == 1 else 56)
                if rep == 2:
                    T["strings"].note(at, dur, pitch, 58)
                    T["pipa"].note(at + 0.01, dur, pitch - 12, 60)
                # The yangqin strikes the notes on the beat, an octave down, and rolls the long ones.
                if abs(b - round(b)) < 1e-6:
                    T["yangqin"].note(at, beat, pitch - 12, 62)
                    if beats >= 1.5:
                        for k in range(1, int(beats * 4)):
                            T["yangqin"].note(at + k * beat / 4, beat / 4, pitch - 12 + (12 if k % 2 else 0), 40)
                melody.append((at, beats * beat, pitch))
            if end:
                T["huqin"].marker(at + beats * beat, "cadence")
                ends.append(at + beats * beat)
            b += beats
        if rep == 1:
            for k in range(int(b)):
                T["woodblock"].note(t + k * beat, 0.1, 76, 44 if k % 2 else 56)
        orchestra(T, melody, windows_of(t, b * beat, 4 * beat, ends, lambda _: level), beat=beat, top=66, swell_in=t if rep == 2 else 0)
        t += b * beat + beat * 2
        T["huqin"].marker(t, "stanza")
    return list(T.values())


# China's theme through the ages. One tune, Mo Li Hua, arranged once for each era of the timeline, as a game
# scores a civilisation's theme from its ancient to its modern age: the melody stays, the instruments around
# it change. Every arrangement plays it three times with the same phrases, so the music can move from one
# age's arrangement to the next at the end of a phrase and carry on with the following one.

def theme(name: str, members: list[str], beat: float, levels: list[float], play, top: int = 66, taiko: bool = False, transpose: int = 2):
    """`play(T, rep, at, dur, pitch, on_beat, phrase_start, beats, pos)` sounds one melody note (at `pos`
    beats into its bar) in time through `rep` (0, 1, 2); the orchestra plays beneath at `levels[rep]`."""

    def arrange(score: dict) -> list[Track]:
        T = tracks(members + ORCHESTRA)
        mark = T[members[0]]
        notes = parse_notes(score["notes"], transpose)
        meter = score.get("meter", 4)
        t = 0.6
        for rep, level in enumerate(levels):
            b = 0.0
            melody: list[tuple[float, float, int]] = []
            ends: list[float] = []
            start = True
            for pitch, beats, end in notes:
                at = t + b * beat
                if pitch is not None:
                    play(T, rep, at, beats * beat * 0.94, pitch, abs(b - round(b)) < 1e-6, start, beats, b % meter)
                    melody.append((at, beats * beat, pitch))
                    start = False
                if end:
                    mark.marker(at + beats * beat, "cadence")
                    ends.append(at + beats * beat)
                    start = True
                b += beats
            orchestra(T, melody, windows_of(t, b * beat, 4 * beat, ends, lambda _: level), beat=beat, top=top, taiko=taiko and rep == 2, swell_in=t if level >= 3.5 else 0)
            t += b * beat + beat * 2
            mark.marker(t, "stanza")
        return list(T.values())

    arrange.__name__ = name
    return arrange


def _early(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # Bronze and clay: the xun alone, then the se beneath, then the bell-chime giving each beat's note.
    T["xun"].note(at, dur, p, 74 if rep != 2 else 60)
    if rep >= 1 and on_beat:
        T["se"].note(at + 0.03, dur, p - 12, 60)
    if rep == 2 and on_beat:
        T["bianzhong"].note(at, 1.4, p + 12, 66)
    if start:
        T["drum"].note(at, 0.3, 45, 50 + 10 * rep)
        if rep == 2:
            T["tezhong"].note(at, 2.5, p - 24, 60)
    if beats >= 2:
        T["bianqing"].note(at + dur * 0.6, 0.4, p, 56)


def _classical(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The scholar's qin, then the xiao singing over it, then the court: se and bells.
    if rep == 0:
        T["qin"].note(at, dur, p, 86)
    else:
        T["xiao"].note(at, dur, p + 12, 70)
        if on_beat:
            T["qin"].note(at + 0.02, dur, p - 12, 68)
    if rep == 2:
        if on_beat:
            T["se"].note(at + 0.05, dur, p - 24, 52)
        if start:
            T["bianzhong"].note(at, 1.8, p + 12, 64)


def _caravans(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The pipa from Central Asia, trembling its long notes; the di and the sheng's chords; a frame drum.
    if rep != 1:
        T["pipa"].note(at, dur, p, 88 if rep == 0 else 70)
    if rep >= 1:
        T["dizi"].note(at, dur, p + 12, 64 if rep == 1 else 52)
    if rep >= 1 and on_beat:
        T["sheng"].note(at, dur, p, 40)
        T["sheng"].note(at, dur, p + 7, 30)
    if start or (rep == 2 and on_beat and beats >= 1):
        T["drum"].note(at, 0.25, 48, 56 + 8 * rep)


def _crossings(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The teahouse: huqin and pipa, the di joining, clapper and wood block keeping time.
    T["huqin"].note(at, dur, p, 84 if rep != 1 else 66)
    if rep >= 1:
        T["dizi"].note(at, dur, p + 12, 62 if rep == 1 else 50)
    if on_beat:
        T["pipa"].note(at + 0.02, dur, p - 12, 58)
        if rep >= 1:
            (T["clapper"] if start else T["woodblock"]).note(at, 0.12, 76, 60 if start else 44)


def _steam(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The street band: the sheng alone first, then the suona over it, drums, cymbals and a gong at each close.
    if rep == 0:
        T["sheng"].note(at, dur, p, 60)
        T["sheng"].note(at, dur, p + 7, 40)
    else:
        T["suona"].note(at, dur, p + 12, 80 if rep == 1 else 86)
        T["sheng"].note(at, dur, p, 44)
    if on_beat and rep >= 1:
        T["drum"].note(at, 0.2, 48, 70)
        T["cymbals"].note(at, 0.2, 80, 40)
    if beats >= 2 and rep >= 1:
        T["gong"].note(at + dur * 0.8, 2.5, 38, 60)


def _shared(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # A modern Chinese orchestra: the erhu over the yangqin, the di joining, then everyone, the strings
    # doubling the erhu.
    T["huqin"].note(at, dur, p, 88 if rep != 1 else 66)
    if rep >= 1:
        T["dizi"].note(at, dur, p + 12, 70 if rep == 1 else 56)
    if rep == 2:
        T["strings"].note(at, dur, p, 56)
    if on_beat:
        T["yangqin"].note(at, 0.5, p - 12, 60)
        if beats >= 1.5:
            for k in range(1, int(beats * 4)):
                T["yangqin"].note(at + k * 0.14, 0.14, p - 12 + (12 if k % 2 else 0), 38)


# The second theme, the serious one: the Guiding March, the court's processional, from a slow procession of
# bells and drums to a modern orchestra's anthem. Moved down a minor third, so that it ends on D.

def _march_drums(T, rep, at, pos, big=False):
    if pos == 0:
        T["drum"].note(at, 0.3, 48, 74 + 6 * rep)
    elif pos == 2 and rep >= 1:
        T["drum"].note(at, 0.3, 45, 56)


def _m_early(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # A procession of bronze: the bell-chime gives the tune, the drum walks, the xun joins, the great bell
    # opens each phrase.
    T["bianzhong"].note(at, max(dur, 1.2), p + 12, 70)
    if rep >= 1:
        T["xun"].note(at, dur, p, 60)
    if start:
        T["tezhong"].note(at, 3.0, p - 24, 66)
    if beats >= 4:
        T["bianqing"].note(at + dur * 0.5, 0.4, p, 58)
    _march_drums(T, rep, at, pos)


def _m_classical(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The court of the Han and Tang: the sheng's chords carrying the tune, the xiao over it, then bells.
    T["sheng"].note(at, dur, p, 56)
    T["sheng"].note(at, dur, p + 7, 40)
    if rep >= 1:
        T["xiao"].note(at, dur, p + 12, 66)
    if rep == 2 and on_beat and pos in (0, 2):
        T["bianzhong"].note(at, 1.4, p + 12, 60)
    _march_drums(T, rep, at, pos)


def _m_caravans(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The band Van Aalst heard: double reeds and flutes on the tune, the sheng beneath, gong-chimes, drums
    # and castanets.
    T["guanzi"].note(at, dur, p, 80)
    if rep >= 1:
        T["dizi"].note(at, dur, p + 12, 58)
        T["sheng"].note(at, dur, p, 44)
    if on_beat and pos in (0, 2):
        T["yunluo"].note(at, 1.0, p + 12, 56)
    _march_drums(T, rep, at, pos)
    if pos == 2:
        T["clapper"].note(at, 0.2, 76, 70)


def _m_crossings(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The Ming court: the same band, fuller, the di an octave up and the gong-chimes on every beat.
    T["guanzi"].note(at, dur, p, 76)
    T["dizi"].note(at, dur, p + 12, 56 if rep else 46)
    T["sheng"].note(at, dur, p, 44)
    T["sheng"].note(at, dur, p + 7, 32)
    if on_beat:
        T["yunluo"].note(at, 0.9, p + 12, 52)
    _march_drums(T, rep, at, pos)
    if pos == 2:
        T["clapper"].note(at, 0.2, 76, 66)


def _m_steam(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The procession as the nineteenth century heard it: suonas over the sheng, drums, cymbals, a gong at the
    # end of each phrase.
    T["suona"].note(at, dur, p + 12, 74 if rep == 0 else 84)
    T["sheng"].note(at, dur, p, 46)
    _march_drums(T, rep, at, pos)
    if on_beat and pos in (1, 3):
        T["cymbals"].note(at, 0.2, 80, 44)
    if beats >= 4:
        T["gong"].note(at + dur * 0.4, 2.5, 38, 66)


def _m_shared(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # A modern orchestra's anthem: strings take the tune first with the di, then the horns, then everyone.
    if rep == 0:
        T["strings"].note(at, dur, p, 62)
        T["dizi"].note(at, dur, p + 12, 52)
    else:
        T["horn"].note(at, dur, p, 76 if rep == 1 else 84)
        T["dizi"].note(at, dur, p + 12, 56)
    if rep == 2:
        T["strings"].note(at, dur, p + 12, 60)
        T["suona"].note(at, dur, p + 12, 50)
    if pos == 0:
        T["timpani"].note(at, 0.4, 38 if p % 12 in (2, 9) else 45, 60 + 8 * rep)


THEME = {
    "molihua-early": ("molihua", theme("molihua_early", ["xun", "se", "bianzhong", "bianqing", "tezhong", "drum"], 0.9, [0, 1, 1], _early, top=62)),
    "molihua-classical": ("molihua", theme("molihua_classical", ["qin", "xiao", "se", "bianzhong"], 0.8, [1, 1, 2], _classical, top=64)),
    "molihua-caravans": ("molihua", theme("molihua_caravans", ["pipa", "dizi", "sheng", "drum"], 0.68, [1, 2, 2], _caravans)),
    "molihua-crossings": ("molihua", theme("molihua_crossings", ["huqin", "dizi", "pipa", "clapper", "woodblock"], 0.6, [2, 2, 3], _crossings)),
    "molihua-steam": ("molihua", theme("molihua_steam", ["suona", "sheng", "drum", "cymbals", "gong"], 0.55, [2, 3, 3], _steam, top=68)),
    "molihua-shared": ("molihua", theme("molihua_shared", ["huqin", "dizi", "yangqin"], 0.55, [2, 3, 4], _shared, taiko=True)),
    "march-early": ("guiding-march", theme("march_early", ["bianzhong", "xun", "tezhong", "bianqing", "drum"], 0.85, [0, 1, 1], _m_early, top=62, transpose=-3)),
    "march-classical": ("guiding-march", theme("march_classical", ["sheng", "xiao", "bianzhong", "drum"], 0.8, [1, 1, 2], _m_classical, top=64, transpose=-3)),
    "march-caravans": ("guiding-march", theme("march_caravans", ["guanzi", "dizi", "sheng", "yunluo", "drum", "clapper"], 0.76, [1, 2, 2], _m_caravans, transpose=-3)),
    "march-crossings": ("guiding-march", theme("march_crossings", ["guanzi", "dizi", "sheng", "yunluo", "drum", "clapper"], 0.72, [2, 2, 3], _m_crossings, transpose=-3)),
    "march-steam": ("guiding-march", theme("march_steam", ["suona", "sheng", "drum", "cymbals", "gong"], 0.7, [2, 3, 3.5], _m_steam, top=68, transpose=-3)),
    "march-shared": ("guiding-march", theme("march_shared", ["strings", "horn", "dizi", "suona", "timpani"], 0.7, [2, 3, 4], _m_shared, taiko=True, transpose=-3)),
}


def bars_of(start: float, total: float, beat: float, meter: int, pickup: float, ends: list[float], level: float):
    """Windows of one bar each from `start`, the first only as long as the pickup."""
    out = []
    t = start
    first = pickup * beat
    while t < start + total - 1e-6:
        b = min(start + total, t + (first or meter * beat))
        first = 0
        out.append((t, b, level, any(t < e <= b + 1e-6 for e in ends)))
        t = b
    return out


def roman(levels: list[float]):
    """A Greek song as a Roman house would hear it: the kithara alone first, then the tibia takes the tune
    with the kithara plucking the bass of each bar beneath it, the water organ holding the bar's first note.
    Each time through, the orchestra beneath them a little fuller (`levels`, one for each time)."""

    def arrange(score: dict) -> list[Track]:
        T = tracks(["kithara", "tibia", "hydraulis"] + ORCHESTRA)
        beat, meter, pickup = score["beat"], score["meter"], score.get("pickup", 0)
        notes = parse_notes(score["notes"], score.get("transpose", 0))
        t = 0.5
        for rep, level in enumerate(levels):
            b = 0.0
            melody: list[tuple[float, float, int]] = []
            ends: list[float] = []
            for pitch, beats, end in notes:
                at = t + b * beat
                dur = beats * beat * 0.95
                if pitch is not None:
                    if rep == 0:
                        T["kithara"].note(at, dur, pitch, 88)
                    else:
                        T["tibia"].note(at, dur, pitch, 84)
                        if rep == len(levels) - 1:
                            T["kithara"].note(at + 0.02, dur, pitch - 12, 54)
                    melody.append((at, beats * beat, pitch))
                bar_pos = (b - pickup) % meter
                if rep > 0 and pitch is not None and abs(bar_pos) < 1e-6:
                    T["kithara"].note(at, beat * 0.9, pitch - 12, 60)
                    T["hydraulis"].note(at, meter * beat * 0.95, pitch - 12, 46)
                if end:
                    T["kithara"].marker(at + beats * beat, "cadence")
                    ends.append(at + beats * beat)
                b += beats
            orchestra(T, melody, bars_of(t, b * beat, beat, meter, pickup, ends, level), beat=beat, top=69, swell_in=t if level >= 3 else 0)
            t += b * beat + beat * 2
            T["kithara"].marker(t, "stanza")
        return list(T.values())

    return arrange


PIECES = {
    "guanju": guanju,
    "confucius-hymn": confucius_hymn,
    "madame-wang": madame_wang,
    "mama-hao-mingbai": mama_hao_mingbai,
    # The epitaph is a short, private song: strings and harp at most. Mesomedes wrote for Hadrian's court.
    "seikilos": roman([1, 2, 2]),
    "calliope": roman([1, 2, 3]),
    "helios": roman([1, 2, 3.5]),
}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = {**{n: (n, a) for n, a in PIECES.items()}, **THEME}
    for name, (source, arrange) in jobs.items():
        score = json.loads((SCORES / f"{source}.json").read_text(encoding="utf-8"))
        size = write(OUT / f"{name}.mid", arrange(score))
        print(f"  {name}.mid: {size / 1000:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
