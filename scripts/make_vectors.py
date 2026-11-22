"""Generate reference vectors for the TypeScript port from the Python host package.

Run from the repository root with the host package importable, for example:

    PYTHONPATH=host python ios-app/scripts/make_vectors.py ios-app/__tests__/vectors.json

Every expected value comes from host/ausculpatch itself, so the Jest tests check
the phone app against the code the desktop apps already trust.
"""
from __future__ import annotations

import base64
import json
import random
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import numpy as np
import scipy.signal as signal

from ausculpatch import protocol as proto
from ausculpatch import vitals
from ausculpatch.decode import decode_stream
from ausculpatch.dump import DumpAssembler
from ausculpatch.filters import (BREATHING_FILTER, ECG_FILTER, HEART_SOUND_FILTER,
                                 BlockMeanDecimator, StreamingFilter)
from ausculpatch.flashlog import read_flash_image
from ausculpatch.storage import CsvRecorder, flash_image_to_csv

rng = random.Random(1234)
nrng = np.random.default_rng(1234)
b64 = lambda b: base64.b64encode(bytes(b)).decode()


def make_page(records: bytes, seq: int, session: int, corrupt_crc: bool = False) -> bytes:
    crc = zlib.crc32(records) & 0xFFFFFFFF
    if corrupt_crc:
        crc ^= 0xFFFFFFFF
    header = struct.pack("<IIHHI", proto.LOG_PAGE_MAGIC, seq, len(records), session, crc)
    return header + records + bytes(proto.PAGE_PAYLOAD_SIZE - len(records))


def random_records(ts: int, budget: int) -> tuple[bytes, int]:
    out = bytearray()
    while True:
        kind = rng.choice(["aco", "aco", "ecg", "ecg", "imu", "temp", "batt"])
        if kind == "aco":
            n = rng.choice([33, 33, 33, 20])  # 20 -> padded chunk
            samples = []
            for _ in range(n):
                ts = (ts + 500) & 0xFFFFFFFF
                samples.append((ts, rng.randint(-(1 << 23), (1 << 23) - 1)))
            rec = proto.encode_acoustic_chunk(samples)
        elif kind == "ecg":
            ts = (ts + 4000) & 0xFFFFFFFF
            rec = proto.encode_ecg(ts, rng.randint(-(1 << 23), (1 << 23) - 1))
        elif kind == "imu":
            ts = (ts + 2000) & 0xFFFFFFFF
            rec = proto.encode_imu(ts, [rng.randint(-32768, 32767) for _ in range(6)])
        elif kind == "temp":
            ts = (ts + 100000) & 0xFFFFFFFF
            rec = proto.encode_temp(ts, rng.randint(2500, 4000))
        else:
            ts = (ts + 1000000) & 0xFFFFFFFF
            rec = proto.encode_batt(ts, rng.randint(1800, 2400))
        if len(out) + len(rec) > budget:
            return bytes(out), ts
        out += rec


def build_v2_image(session: int = 7) -> bytes:
    pages = []
    epoch = (1 << 32) - 3_000_000  # crosses the 32-bit wrap inside the recording
    ts = epoch & 0xFFFFFFFF
    for seq in range(24):
        if seq == 12:
            epoch += 3 * 3600 * 1_000_000  # duty-cycle gap longer than the wrap
            ts = epoch & 0xFFFFFFFF
        sync = proto.encode_timesync(ts, epoch)
        body, new_ts = random_records(ts, proto.PAGE_PAYLOAD_SIZE - len(sync))
        epoch += (new_ts - ts) & 0xFFFFFFFF
        ts = new_ts
        page_session = 3 if seq == 20 else session
        pages.append(make_page(sync + body, seq, page_session, corrupt_crc=(seq == 5)))
    pages[9] = bytes(proto.PAGE_SIZE)  # a page lost in transit, zero-filled
    return b"".join(pages)


def build_legacy_image() -> bytes:
    out = bytearray()
    ts = 1000
    for _ in range(6):
        body, ts = random_records(ts, proto.LEGACY_PAGE_USABLE_SIZE)
        page = bytearray(body + bytes(proto.LEGACY_PAGE_USABLE_SIZE - len(body)))
        page[len(body) // 2] ^= 0x5A  # some damage, so the resync count is exercised
        out += page
    return bytes(out)


def csv_of_image(image: bytes, session):
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "x.csv"
        rows, report = flash_image_to_csv(image, 0, path, session=session)
        return path.read_text(), rows, report.summary()


def flash_vectors():
    out = []
    v2 = build_v2_image()
    for session in (None, 7):
        text, rows, summary = csv_of_image(v2, session)
        out.append({"name": f"v2 session={session}", "image": b64(v2), "session": session,
                    "csv": text, "rows": rows, "summary": summary})
    legacy = build_legacy_image()
    text, rows, summary = csv_of_image(legacy, None)
    out.append({"name": "legacy", "image": b64(legacy), "session": None,
                "csv": text, "rows": rows, "summary": summary})
    return out, v2


def dump_vector(image: bytes):
    packets = []
    chunk = 236
    total_pages = len(image) // proto.PAGE_SIZE
    for page in range(total_pages):
        base = page * proto.PAGE_SIZE
        for off in range(0, proto.PAGE_SIZE, chunk):
            payload = image[base + off: base + min(off + chunk, proto.PAGE_SIZE)]
            crc = zlib.crc32(payload) & 0xFFFFFFFF
            packets.append(struct.pack(">II", base + off, crc) + payload)
        packets.append(struct.pack(">II", 0xFFFFFFFF, page))
    # Damage: drop one chunk in page 3, corrupt one in page 4, duplicate one,
    # stop before the last page arrives.
    drop = 3 * 9 + 2
    del packets[drop]
    corrupt = bytearray(packets[4 * 9 + 5])
    corrupt[20] ^= 0xFF
    packets[4 * 9 + 5] = bytes(corrupt)
    packets.insert(10, packets[9])
    packets = packets[: -(9 + 1)]
    packets.append(b"\x00\x01")  # short packet, ignored

    asm = DumpAssembler()
    asm.set_geometry(proto.parse_dump_header_log(
        f"Dump size: {len(image)} bytes ({total_pages} pages) session 7 stride 2048"))
    events = []
    for p in packets:
        e = asm.add_packet(p)
        events.append({"kind": e.kind, "offset": e.offset, "page": e.page,
                       "shouldAck": e.should_ack, "progress": e.progress})
    assembled, gaps = asm.assemble()
    return {
        "header": f"Dump size: {len(image)} bytes ({total_pages} pages) session 7 stride 2048",
        "packets": [b64(p) for p in packets],
        "events": events,
        "image": b64(assembled),
        "gaps": [[g.offset, g.length] for g in gaps],
        "resumePage": asm.resume_page(),
        "report": asm.integrity_report(),
        "crcFailures": asm.crc_failures,
        "duplicates": asm.duplicate_chunks,
    }


def notification_vectors():
    out = []
    for _ in range(12):
        body, _ = random_records(rng.randint(0, 0xFFFFFFFF), rng.choice([60, 120, 240, 480]))
        if rng.random() < 0.3:
            body += bytes([proto.TAG_ECG, 1, 2])  # truncated tail
        batch = decode_stream(body)
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "x.csv"
            with CsvRecorder(path) as rec:
                rec.write_batch(0, batch)
            text = path.read_text()
        out.append({"data": b64(body), "csv": text, "total": batch.total()})
    return out


def log_vectors():
    lines = [
        "RATES:IMU=500,BATT=1,TMP=10,ECG=250,ACO=2000",
        "DUTY:EN=1,ON=60,OFF=240,SINK=FLASH,STATE=IDLE,LEFT=42,BURSTS=3",
        "DUTY:EN=0,ON=60,OFF=240,SINK=LIVE,STATE=OFF,LEFT=0,BURSTS=0",
        "FLASH:ID=0xEFAA21,SESSION=7,PAGES=1234,TOTAL=65536,BYTES=2527232,BAD=3,REC=1,FULL=0",
        "INFO:PROTO=3,MODE=1,MTU=247,PAGE=2048,HDR=16,RST=0x4",
        "Dump size: 4096 bytes (2 pages) session 7 stride 2048",
        "Dump size: 4088 bytes",
        "Dump Complete. TotalBytes:4096",
        "Health -> Miss A/E 0/0",
    ]
    out = []
    for line in lines:
        out.append({
            "line": line,
            "rates": proto.parse_rates_log(line),
            "duty": proto.parse_duty_log(line),
            "flash": proto.parse_flash_log(line),
            "info": proto.parse_info_log(line),
            "dumpHeader": proto.parse_dump_header_log(line),
            "dumpSize": proto.parse_dump_size_log(line),
            "start": proto.is_dump_start_log(line),
            "end": proto.is_dump_end_log(line),
        })
    return out


def command_vectors():
    return {
        "gain": proto.cmd_set_gain_offset(5, 200).hex(),
        "dump0": proto.cmd_start_dump().hex(),
        "dump300": proto.cmd_start_dump(300).hex(),
        "rate": proto.cmd_set_rate("ACO", 4000).hex(),
        "duty": proto.cmd_set_duty_cycle(True, 60, 86400, proto.DUTY_SINK_LIVE).hex(),
        "dutyOff": proto.cmd_set_duty_cycle(False, 60, 240).hex(),
        "ecgMv": proto.ECG_COUNTS_TO_MV,
        "batt": proto.battery_counts_to_volts(2048),
        "nearestAco": proto.nearest_hardware_rate("ACO", 1000),
        "nearestEcg": proto.nearest_hardware_rate("ECG", 375),
        "nearestImu": proto.nearest_hardware_rate("IMU", 5000),
        "reset": proto.describe_reset_reason(0x4 | 0x1),
    }


def dsp_vectors():
    out = {"filters": [], "peaks": [], "vitals": [], "streaming": []}
    specs = [("heart", HEART_SOUND_FILTER, [2000, 4000, 660, 180]),
             ("ecg", ECG_FILTER, [250, 125, 1000]),
             ("breath", BREATHING_FILTER, [50, 45.45])]
    for name, spec, rates in specs:
        for fs in rates:
            sos = spec.design(fs)
            x = nrng.normal(0, 1, 2000) + 500.0
            cold = signal.sosfilt(sos, x)
            zi = signal.sosfilt_zi(sos)
            warm, _ = signal.sosfilt(sos, x, zi=zi * x[0])
            w, h = signal.sosfreqz(sos, worN=64, fs=fs)
            out["filters"].append({"name": name, "fs": fs, "x": x.tolist(), "cold": cold.tolist(),
                                   "warm": warm.tolist(), "freqs": w.tolist(),
                                   "mag": np.abs(h).tolist(), "zi": (zi).tolist()})
    for i in range(20):
        n = 400
        # Odd cases repeat every sample, so every peak is a flat top. Values stay
        # continuous: numpy's argsort orders exact ties between separate peaks
        # in an implementation-defined way that no port can reproduce.
        x = np.repeat(nrng.normal(0, 1, n // 2), 2) if i % 2 else nrng.normal(0, 1, n)
        height = float(np.mean(x) + 0.5 * np.std(x))
        dist = int(nrng.integers(1, 15))
        peaks, _ = signal.find_peaks(x, height=height, distance=dist)
        out["peaks"].append({"x": x.tolist(), "height": height, "distance": dist,
                             "peaks": peaks.tolist()})

    def synth_ecg(fs, bpm, seconds, noise, jitter=0.0, offset=700_000.0):
        t = np.arange(int(fs * seconds)) / fs
        x = np.zeros_like(t)
        beat = 60.0 / bpm
        k = 0.3
        while k < seconds:
            x += 40000 * np.exp(-((t - k) ** 2) / (2 * 0.012 ** 2))
            k += beat * (1 + jitter * nrng.normal())
        return (x + offset + nrng.normal(0, noise, t.size)).tolist()

    cases = [("ecg72", synth_ecg(250, 72, 20, 800), 250),
             ("ecg120at500", synth_ecg(500, 120, 20, 800), 500),
             ("ecg_noise", (nrng.normal(0, 3000, 5000) + 700_000).tolist(), 250),
             ("ecg_short", synth_ecg(250, 72, 1.5, 800), 250)]
    for name, x, fs in cases:
        out["vitals"].append({"kind": "hr", "name": name, "x": x, "fs": fs,
                              "expected": vitals.estimate_heart_rate(x, fs)})

    for name, rpm, fs, seconds, noise in [("breath15", 15, 50, 30, 0.2), ("breath8", 8, 40, 30, 0.1),
                                          ("breath_noise", None, 50, 30, 1.0), ("breath_short", 15, 50, 8, 0.1)]:
        t = np.arange(int(fs * seconds)) / fs
        x = nrng.normal(0, noise, t.size) + 0.01 * t
        if rpm:
            x += np.sin(2 * np.pi * rpm / 60 * t) + 0.17 * np.sin(2 * np.pi * 1.2 * t)
        out["vitals"].append({"kind": "rr", "name": name, "x": x.tolist(), "fs": fs,
                              "expected": vitals.estimate_rate_from_wave(
                                  x, fs, vitals.RR_MIN_BPM, vitals.RR_MAX_BPM, min_seconds=12.0)})

    # Streaming: heart filter + rectify + decimate + breathing filter, in uneven blocks.
    fs = 2000.0
    x = nrng.normal(0, 1000, 8000) + 3000
    t = np.arange(x.size) / fs
    hf, bf, dec = StreamingFilter(HEART_SOUND_FILTER), StreamingFilter(BREATHING_FILTER), BlockMeanDecimator(50.0)
    blocks, heart_all, breath_t, breath_all = [], [], [], []
    i = 0
    while i < x.size:
        n = int(nrng.integers(30, 700))
        xs, ts = x[i:i + n], t[i:i + n]
        blocks.append(n)
        h = hf.process(xs, fs)
        heart_all += h.tolist()
        et, env = dec.process(ts, np.abs(h), fs)
        if et.size:
            breath_t += et.tolist()
            breath_all += bf.process(env, dec.output_rate(fs)).tolist()
        i += n
    out["streaming"] = {"x": x.tolist(), "fs": fs, "blocks": blocks, "heart": heart_all,
                        "breathT": breath_t, "breath": breath_all}
    return out


def main(path: str) -> None:
    flash, v2 = flash_vectors()
    data = {
        "flash": flash,
        "dump": dump_vector(v2),
        "notifications": notification_vectors(),
        "logs": log_vectors(),
        "commands": command_vectors(),
        "dsp": dsp_vectors(),
    }
    Path(path).write_text(json.dumps(data))
    print(f"wrote {path}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "__tests__/vectors.json")
