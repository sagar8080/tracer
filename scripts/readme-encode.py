#!/usr/bin/env python3
"""Encode real README capture sequences as finite GIFs, WebM clips and posters.

Requires Pillow and FFmpeg with the libvpx VP8 encoder. Set KIVO_CAPTURE_FFMPEG
when FFmpeg is not on PATH. Capture inputs remain in the ignored output folder.
"""

from __future__ import annotations

import argparse
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
FEATURE_NAME = re.compile(r"[a-z0-9][a-z0-9_-]*\Z")


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "features", nargs="*", help="Capture folder names; defaults to every completed capture."
    )
    parser.add_argument("--input-dir", type=Path, default=ROOT / "output/readme-capture")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "docs/media")
    parser.add_argument("--gif-width", type=int, default=1080)
    parser.add_argument(
        "--gif-loops", type=int, choices=(1, 2), default=1,
        help="Additional GIF repetitions: 1 plays twice; 2 plays three times (default: 1).",
    )
    parser.add_argument(
        "--poster-frame", default="last", help="Poster frame: last, middle, or a zero-based frame number."
    )
    parser.add_argument(
        "--ffmpeg", default=os.environ.get("KIVO_CAPTURE_FFMPEG") or shutil.which("ffmpeg"),
        help="FFmpeg executable; defaults to KIVO_CAPTURE_FFMPEG or PATH.",
    )
    args = parser.parse_args()
    if not args.ffmpeg:
        parser.error("Set KIVO_CAPTURE_FFMPEG or supply --ffmpeg with a libvpx-enabled FFmpeg.")
    if args.gif_width < 320:
        parser.error("--gif-width must be at least 320 pixels.")
    return args


def load_capture(directory: Path) -> tuple[dict, list[Path]]:
    manifest = json.loads((directory / "capture.json").read_text())
    frames = sorted(directory.glob("[0-9][0-9][0-9][0-9][0-9].png"))
    expected = manifest.get("frames")
    if not isinstance(expected, int) or expected < 1 or expected != len(frames):
        raise ValueError(f"{directory.name}: frame count does not match capture.json")
    if any(frame.name != f"{index:05d}.png" for index, frame in enumerate(frames)):
        raise ValueError(f"{directory.name}: frames must start at 00000.png without gaps")
    fps = manifest.get("fps")
    if not isinstance(fps, (int, float)) or not math.isfinite(fps) or not 0 < fps <= 50:
        raise ValueError(f"{directory.name}: capture.json fps must be greater than 0 and at most 50")
    size = (manifest.get("width"), manifest.get("height"))
    if any(not isinstance(value, int) or value < 1 for value in size):
        raise ValueError(f"{directory.name}: capture.json must contain valid dimensions")
    if manifest.get("errors"):
        raise ValueError(f"{directory.name}: capture recorded application errors; inspect capture.json")
    for path in frames:
        with Image.open(path) as frame:
            if frame.size != size:
                raise ValueError(f"{path}: dimensions differ from capture.json")
    return manifest, frames


def sample_indexes(count: int, samples: int) -> list[int]:
    if count == 1:
        return [0]
    samples = min(count, samples)
    return sorted({round(index * (count - 1) / (samples - 1)) for index in range(samples)})


def resized_frame(path: Path, size: tuple[int, int]) -> Image.Image:
    with Image.open(path) as source:
        frame = source.convert("RGB")
    if frame.size != size:
        frame = frame.resize(size, Image.Resampling.LANCZOS)
    return frame


def encode_gif(frames: list[Path], manifest: dict, destination: Path, args: argparse.Namespace) -> None:
    width = min(args.gif_width, manifest["width"])
    size = (width, round(width * manifest["height"] / manifest["width"]))
    # A palette sampled across the clip preserves UI colors without frame-to-frame
    # palette flicker. Avoid dithering: small text stays clean and deltas compress.
    indexes = sample_indexes(len(frames), 24)
    sample_size = (360, round(360 * size[1] / size[0]))
    palette_canvas = Image.new("RGB", (sample_size[0] * 4, sample_size[1] * math.ceil(len(indexes) / 4)))
    for cell, index in enumerate(indexes):
        sample = resized_frame(frames[index], sample_size)
        palette_canvas.paste(sample, ((cell % 4) * sample_size[0], (cell // 4) * sample_size[1]))
        sample.close()
    palette = palette_canvas.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    palette_canvas.close()
    encoded = []
    try:
        for path in frames:
            frame = resized_frame(path, size)
            encoded.append(frame.quantize(palette=palette, dither=Image.Dither.NONE))
            frame.close()
        # GIF timing uses hundredths of a second. Distribute rounding so an 8 fps
        # capture alternates 120/130 ms and retains its original playback duration.
        durations = [
            10 * (round((index + 1) * 100 / manifest["fps"]) - round(index * 100 / manifest["fps"]))
            for index in range(len(frames))
        ]
        encoded[0].save(
            destination, format="GIF", save_all=True, append_images=encoded[1:],
            duration=durations, loop=args.gif_loops, optimize=True, disposal=1,
        )
    finally:
        palette.close()
        for frame in encoded:
            frame.close()


def encode_webm(frames: list[Path], manifest: dict, destination: Path, ffmpeg: str) -> None:
    # JPEG over image2pipe also works with Playwright's minimal FFmpeg build,
    # which includes the MJPEG decoder but does not include the PNG decoder.
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", str(manifest["fps"]), "-i", "pipe:0",
        "-an", "-c:v", "libvpx", "-b:v", "0", "-crf", "12", "-quality", "good",
        "-cpu-used", "2", "-g", "64", "-pix_fmt", "yuv420p", "-f", "webm", str(destination),
    ]
    # Keep encoder diagnostics on disk while piping frames, avoiding pipe-buffer
    # deadlocks if FFmpeg fails early or emits a large diagnostic message.
    with tempfile.TemporaryFile() as diagnostics:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=diagnostics)
        try:
            assert process.stdin is not None
            for path in frames:
                with Image.open(path) as source:
                    frame = source.convert("RGB")
                with BytesIO() as jpeg:
                    frame.save(jpeg, format="JPEG", quality=97, subsampling=0)
                    process.stdin.write(jpeg.getvalue())
                frame.close()
            process.stdin.close()
            status = process.wait()
        except BaseException as error:
            if process.stdin:
                try:
                    process.stdin.close()
                except BrokenPipeError:
                    pass
            if process.poll() is None:
                process.terminate()
            process.wait()
            diagnostics.seek(0)
            detail = diagnostics.read().decode(errors="replace").strip()
            if isinstance(error, BrokenPipeError):
                raise RuntimeError(f"FFmpeg stopped accepting frames: {detail}") from error
            if detail:
                print(detail, file=sys.stderr)
            raise
        if status:
            diagnostics.seek(0)
            raise RuntimeError(f"FFmpeg exited {status}: {diagnostics.read().decode(errors='replace').strip()}")


def poster_index(value: str, count: int) -> int:
    if value == "last":
        return count - 1
    if value == "middle":
        return count // 2
    try:
        index = int(value)
    except ValueError as error:
        raise ValueError("--poster-frame must be last, middle, or a frame number") from error
    if not 0 <= index < count:
        raise ValueError(f"Poster frame {index} is outside the capture (0–{count - 1})")
    return index


def contact_sheet(frames: list[Path], manifest: dict, destination: Path) -> None:
    indexes = sample_indexes(len(frames), 8)
    tile_width = 420
    tile_height = round(tile_width * manifest["height"] / manifest["width"])
    columns = min(4, len(indexes))
    cell_height = tile_height + 30
    sheet = Image.new("RGB", (columns * tile_width, 48 + math.ceil(len(indexes) / columns) * cell_height), "#111214")
    draw = ImageDraw.Draw(sheet)
    draw.text((12, 15), manifest.get("title", "Kivo capture"), fill="#e9eaed")
    for cell, index in enumerate(indexes):
        left, top = (cell % columns) * tile_width, 48 + (cell // columns) * cell_height
        frame = resized_frame(frames[index], (tile_width, tile_height))
        sheet.paste(frame, (left, top))
        frame.close()
        draw.text((left + 10, top + tile_height + 8), f"Frame {index:05d} · {index / manifest['fps']:.2f}s", fill="#b9bac4")
    sheet.save(destination, format="JPEG", quality=90, subsampling=0)
    sheet.close()


def encode_feature(name: str, args: argparse.Namespace) -> None:
    if not FEATURE_NAME.fullmatch(name):
        raise ValueError(f"Invalid feature folder name: {name!r}")
    directory = args.input_dir / name
    manifest, frames = load_capture(directory)
    selected = poster_index(args.poster_frame, len(frames))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    # Replace published assets only after every format has encoded successfully.
    with tempfile.TemporaryDirectory(prefix=f".{name}-", dir=args.output_dir) as scratch:
        temporary = Path(scratch)
        encode_gif(frames, manifest, temporary / f"{name}.gif", args)
        encode_webm(frames, manifest, temporary / f"{name}.webm", args.ffmpeg)
        with Image.open(frames[selected]) as poster:
            poster.save(temporary / f"{name}.png", format="PNG", optimize=True)
        for extension in ("gif", "webm", "png"):
            (temporary / f"{name}.{extension}").replace(args.output_dir / f"{name}.{extension}")
    contact_sheet(frames, manifest, directory / "contact-sheet.jpg")
    sizes = {extension: round((args.output_dir / f"{name}.{extension}").stat().st_size / 1024**2, 2) for extension in ("gif", "webm", "png")}
    print(json.dumps({"name": name, "frames": len(frames), "seconds": round(len(frames) / manifest["fps"], 2), "sizeMiB": sizes, "posterFrame": selected}))
    if sizes["gif"] > 5:
        print(f"{name}: GIF is {sizes['gif']} MiB; consider a shorter capture or --gif-width 960.", file=sys.stderr)


def main() -> None:
    args = arguments()
    names = args.features or sorted(path.parent.name for path in args.input_dir.glob("*/capture.json"))
    if not names:
        raise ValueError(f"No completed captures in {args.input_dir}")
    for name in names:
        encode_feature(name, args)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Capture encoding failed: {error}", file=sys.stderr)
        sys.exit(1)
