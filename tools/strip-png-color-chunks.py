#!/usr/bin/env python3
"""Remove color-management chunks (gAMA / cHRM / iCCP / sRGB) from PNG files.

  python3 tools/strip-png-color-chunks.py public/textures/water/*.png

## Why this is necessary

The Unity textures have `sRGBTexture: 0` in their `.meta` files, marking them as data
textures, so Unity passes the PNG's **raw 8-bit values** directly to the GPU.

Browsers, however, honor `gAMA` (for example, 45455 = 1/2.2) and `cHRM` chunks in PNG
files. They linearize with pure power 2.2 and then re-encode with the piecewise sRGB
function. Because sRGB differs significantly from pure 2.2 in dark regions, this
round trip is not an identity operation and **crushes dark values**.

Measured values (`caustic1.png`):

| | mean | min | p50 | p75 |
|---|---|---|---|---|
| Raw file values (= values read by Unity) | 12.80 | 2 | 7 | 13 |
| After Chrome decoding (= GPU values before the fix) | 7.30 | 0 | 1 | 5 |

This reduced the median caustics mask value by a factor of 4.6 and produced solid black
blocks inside the cells (the source of the stepped blocks).

Removing the chunks makes the browser-decoded values match the raw file values (verified).
IDAT / PLTE are left untouched, so pixel data is unchanged and the operation is reversible.

This script is idempotent and leaves files without these chunks unchanged.
"""
import struct
import sys
import zlib

STRIP = {b"gAMA", b"cHRM", b"iCCP", b"sRGB"}
SIG = b"\x89PNG\r\n\x1a\n"


def strip(path: str) -> bool:
    with open(path, "rb") as f:
        data = f.read()
    if not data.startswith(SIG):
        print(f"  skip (not PNG): {path}")
        return False

    out = bytearray(SIG)
    pos = len(SIG)
    removed = []
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        end = pos + 12 + length
        if ctype in STRIP:
            removed.append(ctype.decode())
        else:
            out += data[pos:end]
        pos = end

    if not removed:
        return False
    with open(path, "wb") as f:
        f.write(out)
    print(f"  stripped {','.join(removed)}: {path}")
    return True


def main():
    paths = sys.argv[1:]
    if not paths:
        print(__doc__)
        sys.exit(1)
    n = sum(1 for p in paths if strip(p))
    print(f"{n}/{len(paths)} file(s) modified")


if __name__ == "__main__":
    main()
