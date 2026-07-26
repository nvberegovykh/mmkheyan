/* Invisible LSB steganographic watermark utility.
 * Embeds a short copyright/provenance string into the least-significant bit
 * of the Red and Green channels of the image pixel data. This is visually
 * imperceptible (max ±1/255 per channel) and survives lossless PNG re-encoding.
 * It intentionally does NOT touch the Blue or Alpha channel to reduce any
 * risk of visible banding on flat-color areas, and does not survive JPEG
 * re-compression (by design we always export PNG).
 *
 * Format embedded (before bit-encoding):
 *   MAGIC (4 bytes: "MKW1") + LEN (4 bytes big-endian) + UTF-8 text bytes
 */
/* global window */
(function () {
    const MAGIC = 'MKW1';

    function textToBytes(str) {
        return new TextEncoder().encode(str);
    }
    function bytesToText(bytes) {
        return new TextDecoder().decode(bytes);
    }

    function bytesToBits(bytes) {
        const bits = [];
        for (const byte of bytes) {
            for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
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
                resolve({ canvas, ctx });
            };
            img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
            img.src = url;
        });
    }

    /**
     * Embed an invisible watermark into an image file/blob.
     * @param {File|Blob} file - source image
     * @param {string} text - short text to embed (kept under ~120 chars)
     * @returns {Promise<Blob>} PNG blob with watermark embedded
     */
    async function embedWatermark(file, text) {
        const payloadBytes = textToBytes(MAGIC + String(text).slice(0, 120));
        // Prefix with 32-bit big-endian length of the *text portion only* (excludes magic)
        const textBytes = textToBytes(String(text).slice(0, 120));
        const lenBytes = new Uint8Array(4);
        lenBytes[0] = (textBytes.length >>> 24) & 0xff;
        lenBytes[1] = (textBytes.length >>> 16) & 0xff;
        lenBytes[2] = (textBytes.length >>> 8) & 0xff;
        lenBytes[3] = textBytes.length & 0xff;
        const magicBytes = textToBytes(MAGIC);
        const full = new Uint8Array(magicBytes.length + lenBytes.length + textBytes.length);
        full.set(magicBytes, 0);
        full.set(lenBytes, magicBytes.length);
        full.set(textBytes, magicBytes.length + lenBytes.length);
        const bits = bytesToBits(full);

        const { canvas, ctx } = await loadImageToCanvas(file);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data; // RGBA
        const capacityBits = Math.floor(data.length / 4) * 2; // 2 bits per pixel (R,G LSB)
        if (bits.length > capacityBits) {
            console.warn('Watermark payload too large for image, skipping embed');
            return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
        }

        let bitIdx = 0;
        for (let px = 0; px < data.length / 4 && bitIdx < bits.length; px++) {
            const base = px * 4;
            // Red channel LSB
            data[base] = (data[base] & 0xfe) | bits[bitIdx++];
            if (bitIdx < bits.length) {
                // Green channel LSB
                data[base + 1] = (data[base + 1] & 0xfe) | bits[bitIdx++];
            }
        }
        ctx.putImageData(imgData, 0, 0);
        return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    }

    /**
     * Extract a previously embedded watermark from an image URL/File/Blob.
     * @returns {Promise<string|null>} the embedded text, or null if not found
     */
    async function extractWatermark(fileOrUrl) {
        let source = fileOrUrl;
        if (typeof fileOrUrl === 'string') {
            const res = await fetch(fileOrUrl, { mode: 'cors' });
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
                const channel = (b % 2 === 0) ? 0 : 1; // 0=R,1=G
                const base = px * 4 + channel;
                if (base >= data.length) return null;
                bits.push(data[base] & 1);
            }
            return bits;
        }

        const magicBits = readBits(32, 0);
        if (!magicBits) return null;
        const magicBytes = bitsToBytes(magicBits);
        if (bytesToText(magicBytes) !== MAGIC) return null;

        const lenBits = readBits(32, 32);
        if (!lenBits) return null;
        const lenBytes = bitsToBytes(lenBits);
        const len = (lenBytes[0] << 24) | (lenBytes[1] << 16) | (lenBytes[2] << 8) | lenBytes[3];
        if (!len || len > 200) return null;

        const textBits = readBits(len * 8, 64);
        if (!textBits) return null;
        const textBytes = bitsToBytes(textBits);
        try {
            return bytesToText(textBytes);
        } catch {
            return null;
        }
    }

    window.WATERMARK = { embedWatermark, extractWatermark };
})();
