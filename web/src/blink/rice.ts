// FITS tile-compression decoder: RICE_1 for 32-bit integers (BYTEPIX = 4).
// SPHEREx Level-2 FLAGS extensions are stored this way, one image row per compressed tile, so the browser can read the
// contamination flags of just the rows it needs. Port of the reference decoder in CFITSIO (ricecomp.c, fits_rdecomp).

const FSBITS = 5, FSMAX = 25, BBITS = 32;
const NONZERO = new Uint8Array(256);                 // number of bits needed to represent each byte value
for (let i = 1; i < 256; i++) NONZERO[i] = 32 - Math.clz32(i);

/** decode one Rice-compressed tile of `nx` 32-bit integers; `blockSize` is ZVAL1 (pixels per block, normally 32) */
export function riceDecode32(c: Uint8Array, nx: number, blockSize = 32): Int32Array {
  const out = new Int32Array(nx);
  if (c.length < 4) return out;
  let lastpix = ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) | 0;   // first 4 bytes: the starting value, big-endian
  let p = 4;
  let b = c[p++] ?? 0;                               // bit buffer
  let nbits = 8;                                     // number of valid bits in the buffer
  for (let i = 0; i < nx; ) {
    // each block starts with FSBITS bits giving the number of low "split" bits, minus one
    nbits -= FSBITS;
    while (nbits < 0) { b = (b << 8) | (c[p++] ?? 0); nbits += 8; }
    const fs = (b >>> nbits) - 1;
    b &= (1 << nbits) - 1;
    const imax = Math.min(i + blockSize, nx);
    if (fs < 0) {
      for (; i < imax; i++) out[i] = lastpix;        // low-entropy block: all differences are zero
    } else if (fs === FSMAX) {
      for (; i < imax; i++) {                        // high-entropy block: differences stored as raw 32-bit values
        let k = BBITS - nbits;
        let diff = k >= 32 ? 0 : b << k;
        for (k -= 8; k >= 0; k -= 8) { b = c[p++] ?? 0; diff |= b << k; }
        if (nbits > 0) { b = c[p++] ?? 0; diff |= b >>> -k; b &= (1 << nbits) - 1; } else b = 0;
        diff = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);
        lastpix = (diff + lastpix) | 0; out[i] = lastpix;
      }
    } else {
      for (; i < imax; i++) {                        // normal block: unary-coded high bits + fs low bits
        while (b === 0) { nbits += 8; b = c[p++] ?? 0; if (p > c.length + 8) return out; }
        const nzero = nbits - NONZERO[b];
        nbits -= nzero + 1;
        b ^= 1 << nbits;                             // drop the leading one bit
        nbits -= fs;
        while (nbits < 0) { b = (b << 8) | (c[p++] ?? 0); nbits += 8; }
        let diff = (nzero << fs) | (b >>> nbits);
        b &= (1 << nbits) - 1;
        diff = (diff & 1) === 0 ? diff >>> 1 : ~(diff >>> 1);   // undo the mapping of signed differences to non-negative
        lastpix = (diff + lastpix) | 0; out[i] = lastpix;
      }
    }
  }
  return out;
}
