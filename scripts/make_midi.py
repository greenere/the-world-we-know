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

def theme(name: str, members: list[str], beat: float, levels: list[float], play, top: int = 66, taiko: bool = False, transpose: int = 2, bars: int = 0, bed=None):
    """`play(T, rep, at, dur, pitch, on_beat, phrase_start, beats, pos)` sounds one melody note (at `pos`
    beats into its bar) in time through `rep` (0, 1, 2); the orchestra plays beneath at `levels[rep]`."""

    def arrange(score: dict) -> list[Track]:
        T = tracks(members + ORCHESTRA)
        mark = T[members[0]]
        notes = parse_notes(score["notes"], transpose)
        meter = score.get("meter", 4)
        pickup = score.get("pickup", 0)
        t = 0.6
        for rep, level in enumerate(levels):
            b = 0.0
            melody: list[tuple[float, float, int]] = []
            ends: list[float] = []
            start = True
            for pitch, beats, end in notes:
                at = t + b * beat
                if pitch is not None:
                    play(T, rep, at, beats * beat * 0.94, pitch, abs(b - round(b)) < 1e-6, start, beats, (b - pickup) % meter)
                    melody.append((at, beats * beat, pitch))
                    start = False
                if end:
                    mark.marker(at + beats * beat, "cadence")
                    ends.append(at + beats * beat)
                    start = True
                b += beats
            if bed:
                bed(T, rep, t, b * beat, beat, meter)
            # The harmony changes every four beats, or (`bars`) with the bar lines, a few bars at a time.
            wins = bars_of(t, b * beat, beat, meter * bars, pickup, ends, level) if bars else windows_of(t, b * beat, 4 * beat, ends, lambda _: level)
            orchestra(T, melody, wins, beat=beat, top=top, taiko=taiko and rep == 2, swell_in=t if level >= 3.5 else 0)
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


# Rome's two themes through the ages of Italy: Mesomedes' Hymn to the Sun, written for Hadrian's court (the
# ceremonial one), and the Seikilos epitaph, a song carved on a grave, "while you live, shine" (the folk one).
# From the lyre and aulos of the Etruscans to the chant of the medieval church, the lutes and viols of the
# Renaissance, the opera house and the film orchestra. A historical instrument always has the tune.

def _down(pos):
    return abs(pos) < 1e-6


def _sol_early(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    T["kithara"].note(at, dur, p, 84 if rep == 0 else 60)
    if rep >= 1:
        T["tibia"].note(at, dur, p, 74)
    if rep >= 1 and _down(pos):
        T["tympanum"].note(at, 0.3, 48, 60 + 8 * rep)


def _sol_classical(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The emperor's hymn: the kithara, then the tibia over the water organ, then the bronze cornu.
    lead = ["kithara", "tibia", "cornu"][rep]
    T[lead].note(at, dur, p, 82)
    if rep >= 1 and _down(pos):
        T["hydraulis"].note(at, dur * 1.8, p - 12, 48)
    if rep == 2:
        T["tibia"].note(at, dur, p + 12, 52)
        if _down(pos):
            T["tympanum"].note(at, 0.3, 48, 78)
        elif on_beat:
            T["crotala"].note(at, 0.15, 76, 56)


def _sol_caravans(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The medieval church: singers in plain chant, then in organum (a fifth below), then with the organ and
    # bells.
    T["cantores"].note(at, dur, p, 80)
    if rep >= 1:
        T["cantores"].note(at, dur, p - 7, 60)
    if rep == 2:
        T["organum"].note(at, dur, p - 12, 46)
        if start:
            T["campane"].note(at, 2.5, p + 12, 56)


def _sol_crossings(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # A baroque court: the recorder over the harpsichord's continuo and the viol, then the trumpet.
    T["flauto" if rep < 2 else "tromba"].note(at, dur, p + 12 if rep < 2 else p, 76)
    if on_beat:
        T["cembalo"].note(at, 0.4, p - 12, 56)
    if rep >= 1 and _down(pos):
        T["viola"].note(at, dur * 1.8, p - 24, 58)


def _sol_steam(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The opera house: the oboe sings it over the harp, then the strings join, then the trumpet leads.
    T["oboe" if rep < 2 else "tromba"].note(at, dur, p + 12 if rep < 2 else p, 80)
    if rep >= 1:
        T["strings"].note(at, dur, p, 52)
    if on_beat:
        T["harp"].note(at, 0.6, p - 12, 50)


def _sol_shared(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # A film orchestra: the piano alone, then the strings and horns, then everyone.
    T["pianoforte"].note(at, dur, p + 12, 74 if rep == 0 else 60)
    if _down(pos):
        T["pianoforte"].note(at, dur * 1.5, p - 12, 50)
    if rep >= 1:
        T["strings"].note(at, dur, p, 60)
    if rep == 2:
        T["horn"].note(at, dur, p, 74)
        T["tromba"].note(at, dur, p + 12, 52)


def _seik_early(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    T["tibia" if rep == 1 else "kithara"].note(at, dur, p, 82)
    if rep == 2:
        T["tibia"].note(at, dur, p, 54)
    if rep >= 1 and _down(pos):
        T["kithara"].note(at, dur, p - 12, 50)


def _seik_classical(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    T["kithara" if rep == 0 else "tibia"].note(at, dur, p, 82)
    if rep >= 1 and on_beat:
        T["kithara"].note(at + 0.02, dur, p - 12, 56)
    if rep == 2 and _down(pos):
        T["crotala"].note(at, 0.15, 76, 50)


def _seik_caravans(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # A jongleur's song: the vielle, then the recorder over it, then the lute and the tabor.
    T["vielle" if rep != 1 else "flauto"].note(at, dur, p + (12 if rep == 1 else 0), 78)
    if rep >= 1 and on_beat:
        T["vielle" if rep == 1 else "liuto"].note(at, dur, p - 12, 50)
    if rep == 2 and _down(pos):
        T["tympanum"].note(at, 0.25, 50, 56)


def _seik_crossings(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    T["liuto" if rep == 0 else "flauto"].note(at, dur, p + (12 if rep else 0), 80)
    if rep >= 1 and on_beat:
        T["liuto"].note(at, 0.5, p - 12, 56)
    if rep == 2 and _down(pos):
        T["viola"].note(at, dur * 1.5, p - 24, 52)
        T["cembalo"].note(at, 0.4, p, 44)


def _seik_steam(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # A Neapolitan evening: the mandolin trembling the tune, then the oboe answering, the strings beneath.
    T["mandolino"].note(at, dur, p + 12, 84 if rep != 1 else 62)
    if rep >= 1:
        T["oboe"].note(at, dur, p, 66 if rep == 1 else 52)
    if rep == 2:
        T["strings"].note(at, dur, p, 50)


def _seik_shared(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    T["pianoforte"].note(at, dur, p + 12, 74 if rep == 0 else 58)
    if on_beat:
        T["pianoforte"].note(at, beats * 0.4, p - 12, 44)
    if rep >= 1:
        T["strings"].note(at, dur, p, 58 if rep == 1 else 66)
    if rep == 2:
        T["horn"].note(at, dur, p - 12, 60)
        T["oboe"].note(at, dur, p + 12, 50)


# Japan's two themes through its ages: Kōjō no Tsuki, Taki's solemn song of a moon over a ruined castle
# (the ceremonial one), and Sakura (the folk one). From clay flutes and the wagon zither, to gagaku's shō,
# hichiriki and ryūteki at the Heian court, the koto, shakuhachi and shamisen of Edo, the harmonium and
# school choirs of Meiji, and a film orchestra with koto and shakuhachi.

def _sho(T, at, dur, p, v=40):
    # The shō's cluster (aitake): the note with its fourth and fifth above, held.
    for i in (0, 5, 7):
        T["sho"].note(at, dur, p + i, v)


def _j_early(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    T["tsuchibue"].note(at, dur, p, 70 if rep != 1 else 52)
    if rep >= 1 and _down(pos):
        T["wagon"].note(at, dur * 1.5, p - 12, 60)
    if start:
        T["odaiko"].note(at, 0.5, 41, 50 + 8 * rep)


def _j_classical(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    T["wagon" if rep == 0 else "kagurabue"].note(at, dur, p + (12 if rep else 0), 82 if rep == 0 else 70)
    if rep >= 1 and on_beat:
        T["wagon"].note(at, 0.6, p - 12, 56)
    if rep == 2 and _down(pos):
        T["odaiko"].note(at, 0.5, 41, 64)


def _j_caravans(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The Heian court's gagaku: hichiriki and ryūteki on the tune, the shō's clusters, gakuso and biwa
    # marking the beats, kakko and taiko.
    T["hichiriki"].note(at, dur, p, 76)
    if rep >= 1:
        T["ryuteki"].note(at, dur, p + 12, 56)
    if _down(pos):
        _sho(T, at, dur * 2, p, 34 + 6 * rep)
        if rep >= 1:
            T["gakuso"].note(at, 0.6, p - 12, 56)
            T["biwa"].note(at + 0.05, 0.4, p - 12, 50)
    if start:
        T["odaiko"].note(at, 0.6, 41, 66)
    elif on_beat and rep == 2:
        T["kakko"].note(at, 0.1, 76, 46)


def _j_crossings(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # Edo's sankyoku: the shakuhachi, then the koto leading, then with the shamisen.
    if rep == 0:
        T["shakuhachi"].note(at, dur, p + 12, 74)
    else:
        T["koto"].note(at, dur, p, 82)
        T["shakuhachi"].note(at, dur, p + 12, 50)
    if rep == 2 and on_beat:
        T["shamisen"].note(at + 0.02, 0.4, p, 56)


def _j_steam(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # Meiji: a school song at the harmonium, the choir singing it, then a band's trumpet.
    T["harmonium"].note(at, dur, p, 52)
    if _down(pos):
        T["harmonium"].note(at, dur, p - 12 if p - 12 >= 55 else p - 5, 40)
    if rep >= 1:
        T["voices"].note(at, dur, p, 74)
    if rep == 2:
        T["rappa"].note(at, dur, p, 58)


def _j_shared(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    T["koto" if rep != 1 else "shakuhachi"].note(at, dur, p + (12 if rep == 1 else 0), 80 if rep != 1 else 72)
    if rep >= 1:
        T["strings"].note(at, dur, p, 54 if rep == 1 else 62)
    if rep == 2:
        T["shakuhachi"].note(at, dur, p + 12, 52)
        T["horn"].note(at, dur, p - 12, 56)


JAPAN_MEMBERS = {
    "early": ["tsuchibue", "wagon", "odaiko"],
    "classical": ["wagon", "kagurabue", "odaiko"],
    "caravans": ["hichiriki", "ryuteki", "sho", "gakuso", "biwa", "kakko", "odaiko"],
    "crossings": ["shakuhachi", "koto", "shamisen"],
    "steam": ["harmonium", "voices", "rappa"],
    "shared": ["koto", "shakuhachi", "strings", "horn"],
}
JAPAN_PLAY = {"early": _j_early, "classical": _j_classical, "caravans": _j_caravans, "crossings": _j_crossings, "steam": _j_steam, "shared": _j_shared}


# India's two themes: a Pillari gita in raga Malahari, a hymn to Ganesha and the first song every student of
# Carnatic music learns (the ceremonial one), and an old and popular svarajati in Bilahari (the folk one).
# From voices chanting over the veena, to the temple's nadaswaram and tavil, the sitar, shehnai and sarangi of
# the courts, the violin and harmonium of the nineteenth century, and a film orchestra. A tanpura sounds
# beneath them all.

def _tanpura(T, rep, start, length, beat, meter):
    """The tanpura: pa, sa, sa and the low sa, plucked evenly through each cycle of two seconds or so."""
    step = max(0.45, min(0.75, beat * meter / 4))
    t, k = start, 0
    while t < start + length - 0.1:
        T["tanpura"].note(t, step * 3, [57, 62, 62, 50][k % 4], 44 if k % 4 else 50)
        t += step
        k += 1


def _i_early(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The voices chant it; the veena joins, then the drum.
    T["voices"].note(at, dur, p, 76)
    if rep >= 1 and on_beat:
        T["veena"].note(at, 0.6, p - 12, 54)
    if rep == 2 and _down(pos):
        T["mridangam"].note(at, 0.2, 50, 56)


def _i_classical(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    T["veena" if rep != 1 else "venu"].note(at, dur, p + (12 if rep == 1 else 0), 82 if rep != 1 else 70)
    if rep >= 1 and on_beat:
        T["veena"].note(at, 0.5, p - 12, 50)
    if rep == 2:
        T["venu"].note(at, dur, p + 12, 50)
    if on_beat and rep >= 1:
        T["mridangam"].note(at, 0.15, 50 if _down(pos) else 62, 60 if _down(pos) else 40)


def _i_caravans(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The temple: nadaswaram over its drone reed (the sruti), the tavil beating.
    T["nadaswaram"].note(at, dur, p + 12, 80 if rep else 66)
    if _down(pos):
        T["sruti"].note(at, dur * 2, 62, 34)
    if on_beat:
        T["tavil"].note(at, 0.2, 48 if _down(pos) else 60, 64 if _down(pos) else 42)
    if rep == 2:
        T["veena"].note(at, dur, p, 50)


def _i_crossings(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # A court: the sitar, then the shehnai, then the sarangi with the sitar; the tabla.
    lead = ["sitar", "shehnai", "sarangi"][rep]
    T[lead].note(at, dur, p + (12 if lead == "shehnai" else 0), 82)
    if rep == 2:
        T["sitar"].note(at, dur, p - 12, 50)
    if on_beat:
        T["tabla"].note(at, 0.12, 50 if _down(pos) else 64, 62 if _down(pos) else 40)


def _i_steam(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    # The violin that Carnatic music took up about 1800, with the harmonium and the mridangam.
    T["violin" if rep != 1 else "harmonium"].note(at, dur, p + (12 if rep != 1 else 0), 80 if rep != 1 else 66)
    if rep >= 1 and _down(pos):
        T["harmonium"].note(at, dur * 1.5, p - 12 if p - 12 >= 55 else p - 5, 40)
    if on_beat:
        T["mridangam"].note(at, 0.15, 50 if _down(pos) else 62, 58 if _down(pos) else 38)


def _i_shared(T, rep, at, dur, p, on_beat, start, beats, pos=0):
    T["sitar" if rep == 0 else "bansuri"].note(at, dur, p + (12 if rep else 0), 80 if rep == 0 else 72)
    if rep >= 1:
        T["strings"].note(at, dur, p, 52 if rep == 1 else 62)
    if rep == 2:
        T["sitar"].note(at, dur, p - 12, 50)
    if on_beat:
        T["tabla"].note(at, 0.12, 50 if _down(pos) else 64, 60 if _down(pos) else 40)


INDIA_MEMBERS = {
    "early": ["voices", "veena", "mridangam", "tanpura"],
    "classical": ["veena", "venu", "mridangam", "tanpura"],
    "caravans": ["nadaswaram", "sruti", "tavil", "veena", "tanpura"],
    "crossings": ["sitar", "shehnai", "sarangi", "tabla", "tanpura"],
    "steam": ["violin", "harmonium", "mridangam", "tanpura"],
    "shared": ["sitar", "bansuri", "strings", "tabla", "tanpura"],
}
INDIA_PLAY = {"early": _i_early, "classical": _i_classical, "caravans": _i_caravans, "crossings": _i_crossings, "steam": _i_steam, "shared": _i_shared}
LEVELS = {"early": [0, 1, 1], "classical": [1, 1, 2], "caravans": [1, 2, 2], "crossings": [1, 2, 2.5], "steam": [2, 2, 3], "shared": [2, 3, 4]}
ERA_KEYS = ["early", "classical", "caravans", "crossings", "steam", "shared"]
JAPAN_BEAT = {"kojo": [0.8, 0.72, 0.72, 0.66, 0.62, 0.62], "sakura": [0.75, 0.68, 0.7, 0.62, 0.6, 0.6]}
INDIA_BEAT = {"gita": [0.62, 0.52, 0.5, 0.48, 0.46, 0.46], "bilahari": [0.9, 0.78, 0.74, 0.72, 0.68, 0.66]}

ASIA_THEME = {}
for th, score in (("kojo", "kojo-no-tsuki"), ("sakura", "sakura")):
    for i, era in enumerate(ERA_KEYS):
        ASIA_THEME[f"{th}-{era}"] = (score, theme(f"{th}_{era}", JAPAN_MEMBERS[era], JAPAN_BEAT[th][i], LEVELS[era], JAPAN_PLAY[era], top=62, transpose=json.loads((SCORES / f"{score}.json").read_text())["transpose"], bars=1, taiko=era == "shared"))
for th, score in (("gita", "malahari-gita"), ("bilahari", "bilahari")):
    for i, era in enumerate(ERA_KEYS):
        ASIA_THEME[f"{th}-{era}"] = (score, theme(f"{th}_{era}", INDIA_MEMBERS[era], INDIA_BEAT[th][i], [min(x, 3) for x in LEVELS[era]], INDIA_PLAY[era], top=60, transpose=2, bars=1, bed=_tanpura))


# A table-driven arrangement, for the traditions added later: for each era, who leads each verse, who joins
# (from which verse), who plays the bass on the downbeats, who holds the bar's first note, and the drums.

def arranged(spec):
    """`spec`: lead: [(member, octave)] for verses 1-3; join: [(from verse, member, octave, velocity)];
    bass: (member, octave, from verse); hold: (member, octave, from verse); drums: [(member, pitch, "down" |
    "beat" | "start", from verse, velocity)]."""

    def play(T, rep, at, dur, p, on_beat, start, beats, pos=0):
        m, o = spec["lead"][rep]
        T[m].note(at, dur, p + 12 * o, 82)
        for frm, jm, jo, v in spec.get("join", []):
            if rep >= frm and jm != m:
                T[jm].note(at + 0.015, dur, p + 12 * jo, v)
        down = abs(pos) < 1e-6
        if spec.get("bass") and rep >= spec["bass"][2] and down:
            bm, bo, _ = spec["bass"]
            T[bm].note(at, max(dur, 0.6), p + 12 * bo, 58)
        if spec.get("hold") and rep >= spec["hold"][2] and down:
            hm, ho, _ = spec["hold"]
            T[hm].note(at, dur * 2, p + 12 * ho, 40)
        for dm, pitch, when, frm, v in spec.get("drums", []):
            if rep < frm:
                continue
            if (when == "down" and down) or (when == "start" and start) or (when == "beat" and on_beat and not down):
                T[dm].note(at, 0.2, pitch, v)

    return play


def members_of(spec):
    out = [m for m, _ in spec["lead"]] + [j[1] for j in spec.get("join", [])]
    out += [spec[k][0] for k in ("bass", "hold") if spec.get(k)] + [d[0] for d in spec.get("drums", [])]
    return list(dict.fromkeys(out))


# Europe's two themes: the processional chant Veni, veni Emmanuel (the ceremonial one) and Greensleeves (the
# folk one). From the bronze lurs and lyres of the north, the harps and crwths of the Celts, through the chant
# and organ of the medieval church, the lutes, recorders and viols of the Renaissance, the Victorian organ and
# parlour, to a film orchestra.
EUROPE = {
    "emmanuel": {
        "early": {"lead": [("lur", 0), ("lur", 0), ("lur", 0)], "join": [(1, "lyre", 0, 56)], "drums": [("drum", 45, "start", 0, 60)], "hold": ("lur", -1, 2)},
        "classical": {"lead": [("cruit", 0), ("crwth", 0), ("crwth", 0)], "join": [(1, "cruit", -1, 54), (2, "carnyx", 0, 46)], "drums": [("drum", 45, "down", 1, 56)]},
        "caravans": {"lead": [("voices", 0), ("voices", 0), ("voices", 0)], "join": [(1, "voices", -1, 56), (2, "organ", -1, 44)], "hold": ("organ", -1, 1), "drums": [("bells", 74, "start", 2, 50)]},
        "crossings": {"lead": [("voices", 0), ("viol", 0), ("voices", 0)], "join": [(1, "organ", -1, 44), (2, "viol", -1, 50)], "bass": ("viol", -1, 1)},
        "steam": {"lead": [("organ", 0), ("voices", 0), ("voices", 0)], "join": [(1, "organ", -1, 46), (2, "strings", 0, 54)], "bass": ("organ", -1, 0)},
        "shared": {"lead": [("voices", 0), ("strings", 0), ("horn", 0)], "join": [(1, "voices", -1, 56), (2, "strings", 1, 56), (2, "voices", 0, 60)], "drums": [("timpani", 38, "start", 2, 66)]},
    },
    "greensleeves": {
        "early": {"lead": [("lyre", 0), ("pipe", 1), ("pipe", 1)], "join": [(1, "lyre", -1, 52)], "drums": [("drum", 48, "down", 2, 52)]},
        "classical": {"lead": [("cruit", 0), ("pipe", 1), ("crwth", 0)], "join": [(1, "cruit", -1, 52), (2, "pipe", 1, 48)], "drums": [("drum", 48, "down", 1, 50)]},
        "caravans": {"lead": [("vielle", 0), ("recorder", 1), ("vielle", 0)], "join": [(1, "lute", -1, 48), (2, "vielle", 0, 46)], "drums": [("tabor", 62, "down", 1, 54)]},
        "crossings": {"lead": [("lute", 0), ("recorder", 1), ("viol", 0)], "join": [(1, "lute", -1, 54), (2, "virginals", 0, 44)], "bass": ("viol", -1, 1)},
        "steam": {"lead": [("piano", 0), ("violin", 0), ("violin", 0)], "join": [(1, "piano", -1, 50), (2, "oboe", 1, 46)], "bass": ("piano", -2, 0)},
        "shared": {"lead": [("piano", 0), ("strings", 0), ("oboe", 1)], "join": [(1, "piano", -1, 48), (2, "strings", 0, 60), (2, "horn", -1, 52)]},
    },
}

# The maqam world's two themes, both noted by Edward Lane in Cairo in the 1830s: the chant of a poet of the
# Hilali epic (the ceremonial one) and the popular song "Doos ya lellee" (the folk one). From the lyre and
# reed pipe of Mesopotamia, the barbat, chang and ney of the Sasanian court, the oud, qanun and ney of the
# Abbasid and Andalusian golden age, the mehter's zurnas and drums, Cairo's takht with its violin, to a film
# orchestra.
MAQAM = {
    "hilali": {
        "early": {"lead": [("lyre", 0), ("zummara", 0), ("zummara", 0)], "join": [(1, "lyre", -1, 54)], "drums": [("daf", 48, "down", 1, 58)]},
        "classical": {"lead": [("barbat", 0), ("ney", 1), ("ney", 1)], "join": [(1, "barbat", -1, 54), (2, "chang", 0, 46)], "drums": [("daf", 48, "down", 1, 58), ("daf", 60, "beat", 2, 40)]},
        "caravans": {"lead": [("oud", 0), ("ney", 1), ("oud", 0)], "join": [(1, "qanun", 0, 50), (2, "ney", 1, 50)], "drums": [("darbuka", 48, "down", 0, 60), ("riq", 64, "beat", 1, 42)]},
        "crossings": {"lead": [("zurna", 1), ("zurna", 1), ("zurna", 1)], "join": [(1, "zurna", 0, 56)], "drums": [("davul", 45, "down", 0, 74), ("davul", 45, "beat", 1, 52), ("zil", 80, "beat", 2, 44)]},
        "steam": {"lead": [("oud", 0), ("violin", 0), ("violin", 0)], "join": [(1, "qanun", 0, 50), (2, "ney", 1, 50), (2, "oud", -1, 50)], "drums": [("riq", 64, "beat", 0, 44), ("darbuka", 48, "down", 0, 58)]},
        "shared": {"lead": [("oud", 0), ("strings", 0), ("horn", 0)], "join": [(1, "ney", 1, 52), (2, "strings", 0, 60), (2, "oud", -1, 50)], "drums": [("darbuka", 48, "down", 1, 56)]},
    },
    "doos": {
        "early": {"lead": [("zummara", 0), ("zummara", 0), ("lyre", 0)], "join": [(1, "lyre", -1, 52), (2, "zummara", 0, 56)], "drums": [("daf", 48, "down", 0, 56)]},
        "classical": {"lead": [("ney", 1), ("barbat", 0), ("ney", 1)], "join": [(1, "ney", 1, 48), (2, "barbat", -1, 52)], "drums": [("daf", 48, "down", 0, 56), ("daf", 60, "beat", 1, 38)]},
        "caravans": {"lead": [("oud", 0), ("qanun", 0), ("ney", 1)], "join": [(1, "oud", -1, 52), (2, "qanun", 0, 48)], "drums": [("darbuka", 48, "down", 0, 60), ("riq", 64, "beat", 0, 42)]},
        "crossings": {"lead": [("kemenche", 0), ("ney", 1), ("kemenche", 0)], "join": [(1, "oud", -1, 52), (2, "ney", 1, 48)], "drums": [("darbuka", 48, "down", 0, 58), ("riq", 64, "beat", 1, 40)]},
        "steam": {"lead": [("violin", 0), ("qanun", 0), ("violin", 0)], "join": [(1, "oud", -1, 52), (2, "qanun", 0, 48)], "drums": [("riq", 64, "beat", 0, 44), ("darbuka", 48, "down", 0, 58)]},
        "shared": {"lead": [("oud", 0), ("strings", 0), ("ney", 1)], "join": [(1, "oud", -1, 50), (2, "strings", 0, 60), (2, "horn", -1, 50)], "drums": [("darbuka", 48, "down", 0, 56), ("riq", 64, "beat", 1, 40)]},
    },
}
EUROPE_BEAT = {"emmanuel": [0.95, 0.85, 0.82, 0.75, 0.7, 0.7], "greensleeves": [0.8, 0.72, 0.66, 0.6, 0.58, 0.56]}
MAQAM_BEAT = {"hilali": [0.78, 0.7, 0.66, 0.6, 0.6, 0.58], "doos": [0.62, 0.56, 0.52, 0.5, 0.48, 0.46]}
LATER_THEME = {}
for table, beats, scores in ((EUROPE, EUROPE_BEAT, {"emmanuel": "veni-emmanuel", "greensleeves": "greensleeves"}), (MAQAM, MAQAM_BEAT, {"hilali": "hilali", "doos": "doos-ya-lellee"})):
    for th, eras in table.items():
        sc = json.loads((SCORES / f"{scores[th]}.json").read_text())
        for i, era in enumerate(ERA_KEYS):
            spec = eras[era]
            LATER_THEME[f"{th}-{era}"] = (scores[th], theme(f"{th}_{era}", members_of(spec), beats[th][i], LEVELS[era], arranged(spec), top=62, transpose=sc["transpose"], bars=1, taiko=era == "shared"))


ROME_THEME = {
    "sol-early": ("helios", theme("sol_early", ["kithara", "tibia", "tympanum"], 0.75, [0, 1, 1], _sol_early, top=60, transpose=-7, bars=2)),
    "sol-classical": ("helios", theme("sol_classical", ["kithara", "tibia", "cornu", "hydraulis", "tympanum", "crotala"], 0.62, [1, 2, 3], _sol_classical, top=62, transpose=-7, bars=2)),
    "sol-caravans": ("helios", theme("sol_caravans", ["cantores", "organum", "campane"], 0.7, [1, 1, 2], _sol_caravans, top=60, transpose=-7, bars=2)),
    "sol-crossings": ("helios", theme("sol_crossings", ["flauto", "tromba", "cembalo", "viola"], 0.6, [1, 2, 3], _sol_crossings, top=62, transpose=-7, bars=2)),
    "sol-steam": ("helios", theme("sol_steam", ["oboe", "tromba", "strings", "harp"], 0.62, [2, 3, 3.5], _sol_steam, top=64, transpose=-7, bars=2)),
    "sol-shared": ("helios", theme("sol_shared", ["pianoforte", "strings", "horn", "tromba"], 0.62, [2, 3, 4], _sol_shared, top=64, transpose=-7, bars=2, taiko=True)),
    "seikilos-early": ("seikilos", theme("seikilos_early", ["kithara", "tibia"], 0.8, [0, 1, 1], _seik_early, top=62, transpose=-2, bars=1)),
    "seikilos-classical": ("seikilos", theme("seikilos_classical", ["kithara", "tibia", "crotala"], 0.7, [1, 1, 2], _seik_classical, top=64, transpose=-2, bars=1)),
    "seikilos-caravans": ("seikilos", theme("seikilos_caravans", ["vielle", "flauto", "liuto", "tympanum"], 0.66, [1, 1, 2], _seik_caravans, top=64, transpose=-2, bars=1)),
    "seikilos-crossings": ("seikilos", theme("seikilos_crossings", ["liuto", "flauto", "viola", "cembalo"], 0.62, [1, 2, 2], _seik_crossings, top=64, transpose=-2, bars=1)),
    "seikilos-steam": ("seikilos", theme("seikilos_steam", ["mandolino", "oboe", "strings"], 0.6, [2, 2, 3], _seik_steam, top=66, transpose=-2, bars=1)),
    "seikilos-shared": ("seikilos", theme("seikilos_shared", ["pianoforte", "strings", "horn", "oboe"], 0.6, [2, 3, 4], _seik_shared, top=66, transpose=-2, bars=1)),
}


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
    "calliope": roman([1, 2, 3]),
}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = {**{n: (n, a) for n, a in PIECES.items()}, **THEME, **ROME_THEME, **ASIA_THEME, **LATER_THEME}
    for name, (source, arrange) in jobs.items():
        score = json.loads((SCORES / f"{source}.json").read_text(encoding="utf-8"))
        size = write(OUT / f"{name}.mid", arrange(score))
        print(f"  {name}.mid: {size / 1000:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
