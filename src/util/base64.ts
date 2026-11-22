// BLE values cross the native bridge as base64 strings.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Int16Array(256).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function base64ToBytes(s: string): Uint8Array {
  let len = s.length;
  while (len > 0 && s.charCodeAt(len - 1) === 61 /* = */) len--;
  const out = new Uint8Array((len * 3) >> 2);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const v = LOOKUP[s.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    s += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  if (i < b.length) {
    const n = (b[i] << 16) | ((i + 1 < b.length ? b[i + 1] : 0) << 8);
    s += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63];
    s += i + 1 < b.length ? ALPHABET[(n >> 6) & 63] : '=';
    s += '=';
  }
  return s;
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

/** UTF-8 bytes to a string; invalid sequences become U+FFFD. */
export function utf8Decode(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i];
    let cp = 0xfffd;
    let n = 1;
    if (c < 0x80) cp = c;
    else if (c >= 0xc2 && c < 0xe0 && i + 1 < b.length && (b[i + 1] & 0xc0) === 0x80) {
      cp = ((c & 0x1f) << 6) | (b[i + 1] & 0x3f);
      n = 2;
    } else if (c >= 0xe0 && c < 0xf0 && i + 2 < b.length && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80) {
      cp = ((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f);
      n = 3;
    } else if (c >= 0xf0 && c < 0xf5 && i + 3 < b.length && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80 && (b[i + 3] & 0xc0) === 0x80) {
      cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
      n = 4;
    }
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}
