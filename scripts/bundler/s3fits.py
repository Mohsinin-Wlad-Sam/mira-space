"""Minimal remote FITS reader for SPHEREx L2 spectral images on the public S3 bucket.

Reads only what is needed via HTTP byte ranges:
  * HDU headers (walked sequentially; ~6 small requests per file, cached),
  * a contiguous block of rows of an uncompressed 2-D image HDU (IMAGE / VARIANCE / ZODI),
  * whole small table HDUs (WCS-WAVE, one EPSF row on demand).

The bucket sends `Access-Control-Allow-Origin: *`, so the same logic ports 1:1 to the browser.
"""
from __future__ import annotations

import io
import threading
from dataclasses import dataclass

import numpy as np
import requests
from astropy.io import fits

BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/"
BLOCK = 2880
_local = threading.local()


def _session() -> requests.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = requests.Session()
        s.mount("https://", requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=4, max_retries=3))
        _local.s = s
    return s


def get_range(url: str, start: int, stop: int, attempts: int = 6) -> bytes:
    """Inclusive-exclusive byte range [start, stop), with exponential backoff on resets/throttling."""
    import time as _t
    for k in range(attempts):
        try:
            r = _session().get(url, headers={"Range": f"bytes={start}-{stop - 1}"}, timeout=90)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"HTTP {r.status_code}")
            r.raise_for_status()
            return r.content  # may be shorter than requested at end-of-file (legitimate)
        except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as e:
            if k == attempts - 1 or (isinstance(e, requests.HTTPError) and "416" in str(e)):
                raise
            _local.s = None
            _t.sleep(min(30, 1.5 * 2 ** k))


def key_to_url(uri: str) -> str:
    """'ibe/data/spherex/dr1/level2/...fits' or 's3://nasa-irsa-spherex/...' -> https URL."""
    k = uri.replace("s3://nasa-irsa-spherex/", "").replace("ibe/data/spherex/", "")
    return BUCKET + k


@dataclass
class HDUInfo:
    name: str
    header: fits.Header
    header_start: int
    data_start: int
    data_size: int  # unpadded


def _pad(n: int) -> int:
    return (n + BLOCK - 1) // BLOCK * BLOCK


def _data_size(h: fits.Header) -> int:
    naxis = h.get("NAXIS", 0)
    if naxis == 0:
        return 0
    n = abs(h["BITPIX"]) // 8
    for i in range(1, naxis + 1):
        n *= h[f"NAXIS{i}"]
    return n + h.get("PCOUNT", 0)


class RemoteFITS:
    def __init__(self, uri: str, prefetch: int = 64 * BLOCK):
        self.url = key_to_url(uri)
        self.hdus: dict[str, HDUInfo] = {}
        self._walk(prefetch)

    def _read_header(self, start: int, buf: bytes, buf_start: int) -> tuple[fits.Header, int]:
        """Parse a header starting at `start`; fetch more bytes if needed. Returns (header, header_len)."""
        off = start - buf_start
        chunk = buf[off:] if 0 <= off < len(buf) else b""
        while True:
            for i in range(0, len(chunk) - BLOCK + 1, BLOCK):
                block = chunk[i:i + BLOCK]
                for j in range(0, BLOCK, 80):
                    if block[j:j + 8] == b"END     ":
                        hlen = i + BLOCK
                        return fits.Header.fromstring(chunk[:hlen].decode("ascii")), hlen
            chunk = chunk + get_range(self.url, start + len(chunk), start + len(chunk) + 16 * BLOCK)

    def _walk(self, prefetch: int) -> None:
        buf = get_range(self.url, 0, prefetch)
        pos, idx = 0, 0
        while True:
            try:
                hdr, hlen = self._read_header(pos, buf, 0)
            except requests.HTTPError:
                break  # past EOF
            size = _data_size(hdr)
            name = hdr.get("EXTNAME", "PRIMARY" if idx == 0 else f"HDU{idx}")
            self.hdus[name] = HDUInfo(name, hdr, pos, pos + hlen, size)
            pos = pos + hlen + _pad(size)
            idx += 1
            if name == "WCS-WAVE" or idx > 10:
                break
            if pos >= len(buf):
                buf, _ = b"", None  # subsequent headers fetched on demand

    # ---- image access -------------------------------------------------------------------
    def rows(self, name: str, y0: int, y1: int, x0: int = 0, x1: int | None = None) -> np.ndarray:
        """Return image[y0:y1, x0:x1] (FITS row-major: NAXIS1 = x fastest)."""
        h = self.hdus[name]
        nx = h.header["NAXIS1"]
        bpp = abs(h.header["BITPIX"]) // 8
        dtype = {-32: ">f4", -64: ">f8", 32: ">i4", 16: ">i2"}[h.header["BITPIX"]]
        raw = get_range(self.url, h.data_start + y0 * nx * bpp, h.data_start + y1 * nx * bpp)
        arr = np.frombuffer(raw, dtype=dtype).reshape(y1 - y0, nx)
        return arr[:, x0:x1].astype(np.float32)

    def table_hdu(self, name: str) -> fits.BinTableHDU:
        h = self.hdus[name]
        raw = get_range(self.url, h.header_start, h.data_start + _pad(h.data_size))
        return fits.BinTableHDU.fromstring(raw) if hasattr(fits.BinTableHDU, "fromstring") else \
            fits.open(io.BytesIO(fits.PrimaryHDU().header.tostring().encode() + raw))[1]

    def spectral_hdulist(self) -> fits.HDUList:
        """HDUList (IMAGE header + WCS-WAVE table) sufficient for WCS(header, fobj=..., key='W')."""
        h = self.hdus["WCS-WAVE"]
        raw = get_range(self.url, h.header_start, h.data_start + _pad(h.data_size))
        prim = fits.PrimaryHDU().header.tostring().encode()
        hl = fits.open(io.BytesIO(prim + raw))
        img = fits.ImageHDU(header=self.hdus["IMAGE"].header)
        return fits.HDUList([hl[0], img, hl[1]])
