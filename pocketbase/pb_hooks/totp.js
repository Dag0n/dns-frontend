// RFC 6238 TOTP (SHA-1, 6 digits, 30s period) for PocketBase hooks.
//
// PocketBase's JS runtime has no HMAC-SHA1 primitive ($security only offers
// SHA-256/512 variants), and authenticator apps default to SHA-1, so SHA-1
// and HMAC are implemented here in plain JS. Verified against Python's
// hmac/hashlib implementation.

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = B32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) throw new Error("invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return bytes;
}

// SHA-1 over an array of bytes; returns an array of 20 bytes.
function sha1(bytes) {
  const ml = bytes.length * 8;
  const msg = bytes.slice();
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  // 64-bit big-endian length (message sizes here are tiny, high 32 bits ~ 0)
  msg.push(0, 0, 0, 0);
  msg.push((ml >>> 24) & 0xff, (ml >>> 16) & 0xff, (ml >>> 8) & 0xff, ml & 0xff);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const rotl = (n, s) => ((n << s) | (n >>> (32 - s))) >>> 0;

  for (let i = 0; i < msg.length; i += 64) {
    const w = new Array(80);
    for (let j = 0; j < 16; j++) {
      w[j] =
        ((msg[i + j * 4] << 24) |
          (msg[i + j * 4 + 1] << 16) |
          (msg[i + j * 4 + 2] << 8) |
          msg[i + j * 4 + 3]) >>>
        0;
    }
    for (let j = 16; j < 80; j++) {
      w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let j = 0; j < 80; j++) {
      let f;
      let k;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + w[j]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = [];
  [h0, h1, h2, h3, h4].forEach((h) => {
    out.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
  });
  return out;
}

function hmacSha1(keyBytes, msgBytes) {
  let key = keyBytes.slice();
  if (key.length > 64) key = sha1(key);
  while (key.length < 64) key.push(0);

  const ipad = key.map((b) => b ^ 0x36);
  const opad = key.map((b) => b ^ 0x5c);

  return sha1(opad.concat(sha1(ipad.concat(msgBytes))));
}

function hotpCode(secretBytes, counter) {
  const msg = new Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const h = hmacSha1(secretBytes, msg);
  const off = h[19] & 0x0f;
  const bin =
    (((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]) >>> 0;
  const code = String(bin % 1000000);
  return "000000".slice(code.length) + code;
}

// Generate a new random base32 secret (160 bits).
function generateSecret() {
  return $security.randomStringWithAlphabet(32, B32_ALPHABET);
}

// otpauth:// URI for authenticator apps (QR code content).
function otpauthUri(secret, email, issuer) {
  return (
    "otpauth://totp/" +
    encodeURIComponent(issuer) +
    ":" +
    encodeURIComponent(email) +
    "?secret=" +
    secret +
    "&issuer=" +
    encodeURIComponent(issuer) +
    "&algorithm=SHA1&digits=6&period=30"
  );
}

// Verify a 6-digit code against the base32 secret, allowing +/- one
// 30-second step of clock drift. Comparison is constant-time and checks
// every window (no early exit); a corrupt/empty secret counts as a
// failed verification rather than a thrown error.
function verify(secretB32, code) {
  const cleaned = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  let secretBytes;
  try {
    secretBytes = base32Decode(secretB32);
  } catch (_) {
    return false;
  }
  if (secretBytes.length === 0) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  let ok = false;
  for (let w = -1; w <= 1; w++) {
    if ($security.equal(hotpCode(secretBytes, counter + w), cleaned)) ok = true;
  }
  return ok;
}

module.exports = {
  generateSecret: generateSecret,
  otpauthUri: otpauthUri,
  verify: verify,
};
