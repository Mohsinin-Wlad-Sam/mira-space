"""Vectorised, deblended forced photometry of catalog objects on one SPHEREx DR1 cube tile (102 ch, 12.9" HPX px).

Model per channel c:  I_c(p) = B_c(p) + sum_k F_kc * P_c(p - p_k)
  * B_c  smooth background (16x16-px block medians, bilinear upsampled)
  * P_c  circular Gaussian; width measured per band on bright isolated objects with a truncation-calibrated
         second moment (lookup table built from simulated Gaussians on the same 7x7 stamp)
  * F    joint linear solve over all fitted objects: A F = b, A_ij = <P_i,P_j> (analytic), ridge on the diagonal
Errors: per-channel pixel noise (MAD) / sqrt(<P,P>); the tile job rescales them empirically (see tile_job).
Fluxes in microJansky (MJy/sr x HEALPix pixel solid angle).
"""
from __future__ import annotations

import numpy as np
from scipy.ndimage import zoom
from scipy.spatial import cKDTree

NSIDE_PIX = 32 * 512
PIX_SR = 4 * np.pi / (12 * NSIDE_PIX ** 2)    # ~3.9e-10 sr per cube pixel (12.9")
MJYSR_TO_UJY = PIX_SR * 1e12
BANDS = [(0.74, 1.11), (1.11, 1.64), (1.64, 2.42), (2.42, 3.82), (3.82, 4.42), (4.42, 5.01)]
HALF = 3
_OFF = np.arange(-HALF, HALF + 1)


def background(cube, block=16, nclip=3, k=2.5):
    """Sigma-clipped block medians (sources rejected iteratively), bilinear upsampled."""
    nz, ny, nx = cube.shape
    b = cube.reshape(nz, ny // block, block, nx // block, block).transpose(0, 1, 3, 2, 4).reshape(nz, ny // block, nx // block, -1).copy()
    for _ in range(nclip):
        med = np.nanmedian(b, axis=-1, keepdims=True)
        mad = 1.4826 * np.nanmedian(np.abs(b - med), axis=-1, keepdims=True)
        b[(b - med) > k * mad] = np.nan
    med = np.nanmedian(b, axis=-1)
    med = np.where(np.isfinite(med), med, np.nanmedian(med, axis=(1, 2), keepdims=True))
    return np.stack([zoom(m, block, order=1) for m in med]).astype(np.float32)


def _stamps(shape, px, py):
    ix, iy = np.rint(px).astype(int), np.rint(py).astype(int)
    yy = np.clip(iy[:, None, None] + _OFF[None, :, None], 0, shape[-2] - 1)
    xx = np.clip(ix[:, None, None] + _OFF[None, None, :], 0, shape[-1] - 1)
    return yy, xx, ix, iy


def _psf(px, py, ix, iy, sigma):
    dx = ix[:, None, None] + _OFF[None, None, :] - px[:, None, None]
    dy = iy[:, None, None] + _OFF[None, :, None] - py[:, None, None]
    p = np.exp(-(dx ** 2 + dy ** 2) / (2 * sigma ** 2))
    return p / (2 * np.pi * sigma ** 2)


def _moment(st, px, py, ix, iy, rmax=2.5):
    dx = ix[:, None, None] + _OFF[None, None, :] - px[:, None, None]
    dy = iy[:, None, None] + _OFF[None, :, None] - py[:, None, None]
    r2 = dx ** 2 + dy ** 2
    w = np.clip(st, 0, None) * (r2 <= rmax ** 2)
    return (w * r2).sum((1, 2)) / np.maximum(w.sum((1, 2)), 1e-12) / 2


_SIG_GRID = np.linspace(0.4, 2.5, 43)
_rng = np.random.default_rng(0)
_sx, _sy = _rng.uniform(-0.5, 0.5, 400), _rng.uniform(-0.5, 0.5, 400)
_M_GRID = np.array([np.median(_moment(_psf(_sx, _sy, np.zeros(400, int), np.zeros(400, int), s),
                                      _sx, _sy, np.zeros(400, int), np.zeros(400, int))) for s in _SIG_GRID])


def estimate_sigma(band_img, px, py, cand):
    """Truncation-calibrated Gaussian sigma (px) from bright isolated objects `cand`."""
    if len(cand) < 10:
        return np.nan
    yy, xx, ix, iy = _stamps(band_img.shape, px[cand], py[cand])
    st = band_img[yy, xx]
    edge = np.concatenate([st[:, 0, :], st[:, -1, :], st[:, :, 0], st[:, :, -1]], axis=1)
    st = st - np.median(edge, axis=1)[:, None, None]
    m = np.median(_moment(st, px[cand], py[cand], ix, iy))
    return float(np.interp(m, _M_GRID, _SIG_GRID))


def forced_photometry(cube, lam, px, py, brightness, fit_mask=None, ridge=0.05):
    """Returns flux[N,102], err[N,102] (uJy, NaN where not fitted), sigma_c[102] (px), noise_c[102] (MJy/sr)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.linalg import splu
    nz, ny, nx = cube.shape
    n = len(px)
    inside = (px > HALF) & (px < nx - HALF - 1) & (py > HALF) & (py < ny - HALF - 1)
    fit = inside if fit_mask is None else (inside & fit_mask)
    fi = np.where(fit)[0]
    bkg = background(cube)
    fin = np.isfinite(cube)                      # real coverage (NaN = no data in the DR1 cube)
    sub = np.where(fin, cube - np.nan_to_num(bkg), 0.0).astype(np.float32)
    yy, xx, ix, iy = _stamps(sub.shape, px, py)
    tree = cKDTree(np.c_[px[fi], py[fi]])
    pairs = tree.query_pairs(4.0, output_type="ndarray")
    # isolation: no fitted neighbour within 3 px brighter than 10% of the object
    br = np.nan_to_num(brightness[fi])
    iso = np.ones(len(fi), bool)
    close = tree.query_pairs(3.0, output_type="ndarray")
    if len(close):
        a, b = close[:, 0], close[:, 1]
        iso[a[br[b] > 0.1 * br[a]]] = False; iso[b[br[a] > 0.1 * br[b]]] = False
    order = np.argsort(-br)
    cand = fi[order[iso[order]][:150]]
    flux = np.full((n, nz), np.nan, np.float32); err = np.full((n, nz), np.nan, np.float32)
    sig_c = np.full(nz, np.nan); noise_c = np.full(nz, np.nan)
    for b0, b1 in BANDS:
        chans = np.where((lam >= b0) & (lam < b1))[0]
        if len(chans) == 0: continue
        sigma = estimate_sigma(sub[chans].mean(0), px, py, cand)
        if not np.isfinite(sigma): sigma = 0.9
        P = _psf(px[fi], py[fi], ix[fi], iy[fi], sigma)
        nf = len(fi)
        diag = (P ** 2).sum((1, 2))
        if len(pairs):
            i, j = pairs[:, 0], pairs[:, 1]
            d2 = (px[fi][i] - px[fi][j]) ** 2 + (py[fi][i] - py[fi][j]) ** 2
            ov = np.exp(-d2 / (4 * sigma ** 2)) / (4 * np.pi * sigma ** 2)
            rows = np.r_[i, j, np.arange(nf)]; cols = np.r_[j, i, np.arange(nf)]
            vals = np.r_[ov, ov, diag * (1 + ridge)]
        else:
            rows = cols = np.arange(nf); vals = diag * (1 + ridge)
        lu = splu(coo_matrix((vals, (rows, cols)), shape=(nf, nf)).tocsc())
        Bm = np.stack([(P * sub[c][yy[fi], xx[fi]]).sum((1, 2)) for c in chans], 1)
        Fm = lu.solve(Bm)
        for k, c in enumerate(chans):
            real = sub[c][fin[c]]
            if real.size < 2000:                      # channel essentially empty in this tile
                continue
            samp = real[:: max(1, real.size // 20000)]
            mad = float(np.median(np.abs(samp - np.median(samp))) * 1.4826)
            if not np.isfinite(mad) or mad <= 0:
                continue
            cover = fin[c][yy[fi], xx[fi]].mean((1, 2))   # fraction of the 7x7 stamp with real data
            good = (cover >= 0.7) & fin[c][np.clip(iy[fi], 0, ny - 1), np.clip(ix[fi], 0, nx - 1)]
            flux[fi[good], c] = Fm[good, k] * MJYSR_TO_UJY
            err[fi[good], c] = mad / np.sqrt(diag[good]) * MJYSR_TO_UJY
            sig_c[c] = sigma; noise_c[c] = mad
    return flux, err, sig_c, noise_c


def window(flux, err, lam, lo, hi):
    """Inverse-variance mean flux density and error over channels with lo <= lam <= hi."""
    m = (lam >= lo) & (lam <= hi)
    e = err[:, m]
    ok = np.isfinite(flux[:, m]) & np.isfinite(e) & (e > 0)
    w = np.where(ok, 1 / np.where(ok, e, 1.0) ** 2, 0.0)
    sw = w.sum(1)
    with np.errstate(invalid="ignore", divide="ignore"):
        f = np.sum(np.where(ok, flux[:, m], 0.0) * w, 1) / sw
        e = 1 / np.sqrt(sw)
    f[sw == 0] = np.nan; e[sw == 0] = np.nan
    return f, e


synth_band = window  # flat-weighted synthetic band; calibrated against WISE per tile


def blend_groups(px, py, radius=1.5):
    """Friends-of-friends group id per object (cube pixel units)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    n = len(px)
    pr = cKDTree(np.c_[px, py]).query_pairs(radius, output_type="ndarray")
    g = coo_matrix((np.ones(len(pr)), (pr[:, 0], pr[:, 1])), shape=(n, n)) if len(pr) else coo_matrix((n, n))
    return connected_components(g, directed=False)[1]
