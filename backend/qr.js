// Small QR Code encoder (byte mode, error correction level L, versions 1-10).
// Returns the module matrix; the browser draws it as SVG so no markup is ever injected.

const ECC_PER_BLOCK = { 1: 7, 2: 10, 3: 15, 4: 20, 5: 26, 6: 18, 7: 20, 8: 24, 9: 30, 10: 18 };
const BLOCKS = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: 2, 10: 4 };
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function rawModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    result -= (25 * n - 10) * n - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (ver) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];

// Multiplication in GF(2^8) with the QR polynomial 0x11D.
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(deg) {
  const result = new Array(deg - 1).fill(0).concat([1]);
  let root = 1;
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < deg; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < deg) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((c, i) => { result[i] ^= gfMul(c, factor); });
  }
  return result;
}

function interleave(data, ver) {
  const nblocks = BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = nblocks - (raw % nblocks);
  const shortLen = Math.floor(raw / nblocks);
  const divisor = rsDivisor(eccLen);
  const blocks = [];
  let k = 0;
  for (let i = 0; i < nblocks; i++) {
    const size = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const chunk = data.slice(k, k + size);
    k += size;
    const ecc = rsRemainder(chunk, divisor);
    if (i < shortBlocks) chunk.push(0);
    blocks.push(chunk.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(block[i]);
    });
  }
  return out;
}

class Matrix {
  constructor(ver) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.m = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.f = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.#functionPatterns();
  }

  #set(x, y, dark) {
    this.m[y][x] = dark;
    this.f[y][x] = true;
  }

  #functionPatterns() {
    const s = this.size;
    for (let i = 0; i < s; i++) {
      this.#set(6, i, i % 2 === 0);
      this.#set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [s - 4, 3], [3, s - 4]]) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < s && y >= 0 && y < s) {
            const dist = Math.max(Math.abs(dx), Math.abs(dy));
            this.#set(x, y, dist !== 2 && dist !== 4);
          }
        }
      }
    }
    const pos = ALIGN[this.ver];
    pos.forEach((cx, i) => {
      pos.forEach((cy, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) this.#set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      });
    });
    this.formatBits(0);
    if (this.ver >= 7) {
      let rem = this.ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (this.ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >>> i) & 1) === 1;
        const a = s - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.#set(a, b, bit);
        this.#set(b, a, bit);
      }
    }
  }

  formatBits(mask) {
    const s = this.size;
    const data = (1 << 3) | mask;                    // error correction level L = 01
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const g = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i < 6; i++) this.#set(8, i, g(i));
    this.#set(8, 7, g(6));
    this.#set(8, 8, g(7));
    this.#set(7, 8, g(8));
    for (let i = 9; i < 15; i++) this.#set(14 - i, 8, g(i));
    for (let i = 0; i < 8; i++) this.#set(s - 1 - i, 8, g(i));
    for (let i = 8; i < 15; i++) this.#set(8, s - 15 + i, g(i));
    this.#set(8, s - 8, true);
  }

  place(codewords) {
    const s = this.size;
    const total = codewords.length * 8;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const y = ((right + 1) & 2) === 0 ? s - 1 - vert : vert;
          if (!this.f[y][x] && i < total) {
            this.m[y][x] = ((codewords[i >> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  static #maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0;
      default: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
    }
  }

  applyMask(mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.f[y][x] && Matrix.#maskBit(mask, x, y)) this.m[y][x] = !this.m[y][x];
      }
    }
  }

  penalty() {
    const n = this.size;
    const m = this.m;
    let score = 0;
    const cols = Array.from({ length: n }, (_, x) => m.map((row) => row[x]));
    const finderA = '10111010000';
    const finderB = '00001011101';
    for (const lines of [m, cols]) {
      for (const line of lines) {
        let run = 1;
        for (let i = 1; i < n; i++) {
          if (line[i] === line[i - 1]) {
            run++;
          } else {
            if (run >= 5) score += run - 2;
            run = 1;
          }
        }
        if (run >= 5) score += run - 2;
        const seq = line.map((v) => (v ? '1' : '0')).join('');
        for (let i = 0; i < n - 10; i++) {
          const window = seq.slice(i, i + 11);
          if (window === finderA || window === finderB) score += 40;
        }
      }
    }
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
      }
    }
    const dark = m.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    const total = n * n;
    score += Math.max(Math.floor((Math.abs(dark * 20 - total * 10) + total - 1) / total) - 1, 0) * 10;
    return score;
  }
}

/** Encode text as a QR code; returns an array of strings made of "0" (light) and "1" (dark). */
export function makeMatrix(text) {
  const data = new TextEncoder().encode(text);
  let ver = 1;
  let ccBits = 8;
  for (; ver <= 10; ver++) {
    ccBits = ver <= 9 ? 8 : 16;
    if (4 + ccBits + 8 * data.length <= dataCodewords(ver) * 8) break;
  }
  if (ver > 10) throw new RangeError('Text too long for this QR encoder');

  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(data.length, ccBits);
  for (const b of data) put(b, 8);
  const cap = dataCodewords(ver) * 8;
  for (let i = Math.min(4, cap - bits.length); i > 0; i--) bits.push(0);
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  const final = interleave(codewords, ver);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const q = new Matrix(ver);
    q.place(final);
    q.applyMask(mask);
    q.formatBits(mask);
    const p = q.penalty();
    if (best === null || p < best.penalty) best = { penalty: p, q };
  }
  return best.q.m.map((row) => row.map((c) => (c ? '1' : '0')).join(''));
}
