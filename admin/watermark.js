/* One-way cryptographic (HMAC-signed) invisible watermark, v2 ("MKW2").
 *
 * How it's "one-way": the payload embedded in the pixels is a SHA-256
 * content digest + timestamp + random nonce + an HMAC-SHA256 signature
 * over those three values. The HMAC secret key lives ONLY on the
 * Cloudflare Worker (never shipped to any browser), so:
 *   - Nobody reading this public JS file can compute a valid signature
 *     for a new/altered image -- there is no "decrypt" or "forge" path.
 *   - Verification recomputes the same HMAC server-side and compares it
 *     byte-for-byte against what's embedded -- a hard yes/no, not a
 *     fuzzy similarity score, and with no risk of false positives from
 *     unrelated-but-similar images.
 *   - Nothing here ever needs the true original file to be stored
 *     anywhere; verification only needs the (possibly re-compressed via
 *     PNG lossless save, resized-preserving) image with the payload
 *     still intact.
 *
 * Embedded exactly like v1 -- least-significant bit of the Red and Green
 * channels only (Blue/Alpha untouched, imperceptible, PNG-lossless only)
 * -- but the payload format changes completely (v1 plaintext text is no
 * longer produced by this admin panel; MKW2 payload is fixed-size binary):
 *
 *   MAGIC (4 bytes: "MKW2")
 *   + TIMESTAMP (8 bytes, big-endian ms since epoch)
 *   + NONCE (8 bytes, random)
 *   + SIGNATURE (32 bytes, HMAC-SHA256 hex-decoded to raw bytes)
 *   = 52 bytes total = 416 bits = 208 pixels (2 bits/pixel)
 *
 * The signed message is: `${digestHex}:${timestamp}:${nonceHex}` where
 * digestHex is the SHA-256 of the pixel data with the 208 reserved
 * slots zeroed out (so signing doesn't have a chicken-and-egg problem
 * with its own payload, and re-verification re-zeroes those same slots
 * to recompute the identical digest).
 */
/* global window, crypto */
(function () {
    const MAGIC = 'MKW2';
    const RESERVED_PIXELS = 208; // holds the 52-byte / 416-bit payload
    const PAYLOAD_BYTES = 52; // 4 magic + 8 timestamp + 8 nonce + 32 signature

    function bytesToHex(bytes) {
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    function hexToBytes(hex) {
        const clean = String(hex).trim();
        const out = new Uint8Array(clean.length / 2);
        for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
        return out;
    }
    function bytesToBits(bytes) {
        const bits = new Array(bytes.length * 8);
        let k = 0;
        for (const byte of bytes) {
            for (let i = 7; i >= 0; i--) bits[k++] = (byte >> i) & 1;
        }
        return bits;
    }
    function bitsToBytes(bits) {
        const bytes = new Uint8Array(Math.floor(bits.length / 8));
        for (let i = 0; i < bytes.length; i++) {
            let b = 0;
            for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
            bytes[i] = b;
        }
        return bytes;
    }

    function loadImageToCanvas(fileOrBlob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(fileOrBlob);
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                resolve({ canvas, ctx, img });
            };
            img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
            img.src = url;
        });
    }

    /** Zero out the reserved payload slots (R/G LSBs of first RESERVED_PIXELS pixels). */
    function zeroReservedSlots(data) {
        for (let px = 0; px < RESERVED_PIXELS; px++) {
            const base = px * 4;
            if (base + 1 >= data.length) break;
            data[base] &= 0xfe;
            data[base + 1] &= 0xfe;
        }
    }

    async function sha256Hex(bytes) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return bytesToHex(new Uint8Array(digest));
    }

    /**
     * Step 1 of embedding: load the canvas, zero the reserved payload slots
     * (so the digest doesn't depend on payload bytes we haven't written
     * yet), and compute the content digest that will be sent to the
     * Worker for signing. Caller must send `digestHex` + a chosen
     * timestamp/nonce to POST /api/watermark-sign, then pass the
     * returned signature into embedSignature().
     */
    async function prepareForSigning(canvas, ctx) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        zeroReservedSlots(imgData.data);
        const digestHex = await sha256Hex(imgData.data);
        return { canvas, ctx, imgData, digestHex };
    }

    function randomNonceHex() {
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        return bytesToHex(bytes);
    }

    /** Step 2: embed the signed payload (from the Worker) into the pixels and return a PNG blob. */
    function embedSignature({ canvas, ctx, imgData }, timestampMs, nonceHex, signatureHex) {
        const data = imgData.data;
        const magicBytes = new TextEncoder().encode(MAGIC); // 4 bytes
        const tsBytes = new Uint8Array(8);
        // Big-endian 64-bit timestamp (safe: Date.now() fits well under 2^53)
        let t = BigInt(Math.floor(timestampMs));
        for (let i = 7; i >= 0; i--) { tsBytes[i] = Number(t & 0xffn); t >>= 8n; }
        const nonceBytes = hexToBytes(nonceHex); // 8 bytes
        const sigBytes = hexToBytes(signatureHex); // 32 bytes

        const full = new Uint8Array(PAYLOAD_BYTES);
        full.set(magicBytes, 0);
        full.set(tsBytes, 4);
        full.set(nonceBytes, 12);
        full.set(sigBytes, 20);

        const bits = bytesToBits(full); // 416 bits, fits exactly in RESERVED_PIXELS*2
        let bitIdx = 0;
        for (let px = 0; px < RESERVED_PIXELS && bitIdx < bits.length; px++) {
            const base = px * 4;
            data[base] = (data[base] & 0xfe) | bits[bitIdx++];
            if (bitIdx < bits.length) data[base + 1] = (data[base + 1] & 0xfe) | bits[bitIdx++];
        }
        ctx.putImageData(imgData, 0, 0);
        return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    }

    /**
     * Extract the embedded payload from a previously-watermarked image and
     * re-derive the same content digest a verifier needs, by re-zeroing
     * the identical reserved slots before hashing. Returns null if no
     * valid MKW2 payload is present.
     */
    async function extractForVerification(fileOrUrlOrBlob) {
        let source = fileOrUrlOrBlob;
        if (typeof fileOrUrlOrBlob === 'string') {
            const res = await fetch(fileOrUrlOrBlob, { mode: 'cors' });
            source = await res.blob();
        }
        const { canvas, ctx } = await loadImageToCanvas(source);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        function readBits(count, startBit) {
            const bits = [];
            for (let i = 0; i < count; i++) {
                const b = startBit + i;
                const px = Math.floor(b / 2);
                const channel = (b % 2 === 0) ? 0 : 1;
                const base = px * 4 + channel;
                if (base >= data.length) return null;
                bits.push(data[base] & 1);
            }
            return bits;
        }

        const magicBits = readBits(32, 0);
        if (!magicBits) return null;
        const magicBytes = bitsToBytes(magicBits);
        if (new TextDecoder().decode(magicBytes) !== MAGIC) return null;

        const payloadBits = readBits(PAYLOAD_BYTES * 8, 0);
        if (!payloadBits) return null;
        const payload = bitsToBytes(payloadBits);

        const tsBytes = payload.slice(4, 12);
        let timestamp = 0n;
        for (let i = 0; i < 8; i++) timestamp = (timestamp << 8n) | BigInt(tsBytes[i]);
        const nonceHex = bytesToHex(payload.slice(12, 20));
        const signatureHex = bytesToHex(payload.slice(20, 52));

        // Re-zero the same reserved slots to recompute the exact digest that was signed.
        zeroReservedSlots(data);
        const digestHex = await sha256Hex(data);

        return { timestamp: Number(timestamp), nonceHex, signatureHex, digestHex };
    }

    window.WATERMARK = {
        MAGIC,
        RESERVED_PIXELS,
        prepareForSigning,
        embedSignature,
        extractForVerification,
        randomNonceHex,
    };
})();
