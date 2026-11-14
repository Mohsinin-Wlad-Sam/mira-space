"""Streaming readers for the two all-sky inputs of the census. Nothing is written to disk.

Both inputs share HEALPix order-5 NESTED tiling (12,288 tiles), so one tile = one independent job.
  * unWISE time-domain catalog (Meisner+2023, IRSA DOI 10.26131/IRSA580): s3://nasa-irsa-wise (us-west-2), Parquet.
  * SPHEREx DR1 102-channel all-sky cube (IRSA DOI 10.26131/IRSA679): s3://nasa-irsa-spherex (us-east-1), FITS tiles.
"""
from __future__ import annotations

import io
import pathlib
import time
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pyarrow.parquet as pq
import requests
from astropy.io import fits
from astropy.wcs import WCS

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts" / "bundler"))
from s3fits import RemoteFITS, get_range  # noqa: E402

WISE_BUCKET = "https://nasa-irsa-wise.s3.amazonaws.com/"
UNWISE_ROOT = "unwise/neo7/catalogs/time_domain/healpix_k5/unwise-neo7-time_domain-healpix_k5.parquet"
CUBE_ROOT = "dr1/hips5_cube/hips_20261026/Norder5"
UNWISE_COLS = ["ra", "dec", "flux", "dflux", "dx", "dy", "qf", "rchi2", "fracflux", "spread_model",
               "band", "EPOCH", "FORWARD", "MJDMEAN", "primary", "flags_unwise"]


class _HTTPRangeFile(io.RawIOBase):
    """Seekable read-only file over HTTP byte ranges, so pyarrow reads only footer + needed column chunks."""

    def __init__(self, url: str, size: int):
        self.url, self.size, self.pos = url, size, 0
        self.bytes_read = 0
        self._s = requests.Session()

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + n) - 1
        for attempt in range(7):
            try:
                r = self._s.get(self.url, headers={"Range": f"bytes={self.pos}-{end}"}, timeout=120)
                r.raise_for_status(); break
            except requests.RequestException:
                if attempt == 6: raise
                self._s = requests.Session(); time.sleep(min(30, 1.5 * 2 ** attempt))
        b = r.content
        self.pos += len(b); self.bytes_read += len(b)
        return b

    def readinto(self, buf):
        b = self.read(len(buf)); buf[:len(b)] = b; return len(b)


def unwise_part_urls(tile: int) -> list[tuple[str, int]]:
    k0 = tile >> 10
    prefix = f"{UNWISE_ROOT}/healpix_k0={k0}/healpix_k5={tile}/"
    for attempt in range(6):
        try:
            x = requests.get(WISE_BUCKET, params={"list-type": "2", "prefix": prefix}, timeout=60).text; break
        except requests.RequestException:
            if attempt == 5: raise
            time.sleep(min(30, 1.5 * 2 ** attempt))
    import re
    keys = re.findall(r"<Key>([^<]+\.parquet)</Key>\s*<LastModified>[^<]*</LastModified>\s*<ETag>[^<]*</ETag>\s*<Size>(\d+)</Size>", x)
    return [(WISE_BUCKET + k, int(s)) for k, s in keys]


def read_unwise_tile(tile: int, columns=UNWISE_COLS) -> tuple[dict[str, np.ndarray], int]:
    """Return column arrays (primary detections only) and bytes transferred."""
    out, nbytes = [], 0
    for url, size in unwise_part_urls(tile):
        f = _HTTPRangeFile(url, size)
        pf = pq.ParquetFile(io.BufferedReader(f, buffer_size=8 << 20))
        def rg(i):
            ff = _HTTPRangeFile(url, size)
            t = pq.ParquetFile(io.BufferedReader(ff, buffer_size=8 << 20)).read_row_group(i, columns=columns)
            return t, ff.bytes_read
        with ThreadPoolExecutor(8) as ex:
            for t, b in ex.map(rg, range(pf.num_row_groups)):
                out.append(t); nbytes += b
        nbytes += f.bytes_read
    import pyarrow as pa
    tab = pa.concat_tables(out)
    cols = {c: tab.column(c).to_numpy() for c in columns}
    keep = cols["primary"] == 1
    return {c: v[keep] for c, v in cols.items()}, nbytes


def celestial_wcs(hdr: fits.Header) -> WCS:
    hdr = hdr.copy()
    for k in list(hdr.keys()):
        if (k.endswith("3") and k[:-1] in ("NAXIS", "CTYPE", "CUNIT", "CRPIX", "CRVAL", "CDELT", "CNAME")) or \
                k.startswith(("PS3_", "PV3_", "PC3_", "CD3_")) or k in ("PC1_3", "PC2_3", "CD1_3", "CD2_3"):
            del hdr[k]
    hdr["NAXIS"] = 2; hdr["WCSAXES"] = 2
    return WCS(hdr)


NHITS_CHANNELS = [8, 25, 42, 60, 77, 94]  # one representative channel per band (avoids blank 50/51)


def read_cube_tile(tile: int, with_nhits: bool = True):
    """Return (cube[102,512,512] float32 MJy/sr, nhits[6,512,512] or None, wavelengths[102] um, celestial WCS, bytes)."""
    key = f"{CUBE_ROOT}/Dir{(tile // 10000) * 10000}/Npix{tile}_cube.fits"
    rf = RemoteFITS(key)
    h = rf.hdus["IMAGE"]
    nx, ny, nz = h.header["NAXIS1"], h.header["NAXIS2"], h.header["NAXIS3"]
    plane = nx * ny * 4
    def get_plane(args):
        name, c = args
        hh = rf.hdus[name]
        raw = get_range(rf.url, hh.data_start + c * plane, hh.data_start + (c + 1) * plane)
        return name, c, np.frombuffer(raw, ">f4" if hh.header["BITPIX"] == -32 else ">i4").reshape(ny, nx)
    jobs = [("IMAGE", c) for c in range(nz)] + \
        ([(nm, c) for nm in ("NHITS", "FLAGS") for c in NHITS_CHANNELS] if with_nhits else [])
    cube = np.empty((nz, ny, nx), np.float32)
    nh = np.empty((len(NHITS_CHANNELS), ny, nx), np.int16) if with_nhits else None
    fl = np.zeros((len(NHITS_CHANNELS), ny, nx), np.int32) if with_nhits else None
    with ThreadPoolExecutor(16) as ex:
        for name, c, arr in ex.map(get_plane, jobs):
            if name == "IMAGE": cube[c] = arr
            elif name == "NHITS": nh[NHITS_CHANNELS.index(c)] = np.minimum(arr, 32767)
            else: fl[NHITS_CHANNELS.index(c)] = arr
    if with_nhits:
        nh = (nh, fl)  # FLAGS: bitwise OR of OVERFLOW(1)/SOURCE/OUTLIER of contributing pixels
    sc = rf.hdus["SPECTRAL_CHANNELS"]
    raw = get_range(rf.url, sc.header_start, sc.data_start + ((sc.data_size + 2879) // 2880) * 2880)
    tab = fits.open(io.BytesIO(fits.PrimaryHDU().header.tostring().encode() + raw))[1].data
    lamcol = [c for c in tab.columns.names if "CENT" in c.upper() or "WAVE" in c.upper()][0]
    lam = np.array(tab[lamcol], float)
    return cube, nh, lam, celestial_wcs(h.header), len(jobs) * plane
