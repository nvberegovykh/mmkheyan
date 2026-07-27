/* Subtle tiled visible signature overlay.
 *
 * Purely a deterrent + easy-to-spot-at-a-glance ownership mark for anyone
 * who reposts the image elsewhere -- NOT a security mechanism (the crypto
 * watermark in watermark.js is what proves authenticity). Deliberately:
 *   - very low opacity so it never competes with or crosses the artwork,
 *   - staggered/brick-pattern tiling so no single crop can fully avoid it,
 *   - diagonal so it doesn't visually align with any straight edges in
 *     the art (paintings/sculpture photos rarely have diagonal features),
 *   - both a dark stroke and light fill so it stays visible on both dark
 *     and light backgrounds without needing per-image tuning.
 */
/* global window */
(function () {
    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {HTMLCanvasElement} canvas
     * @param {string} label - text to tile, e.g. "© MERUZHAN MKHEYAN"
     */
    function applySmartTiledMark(ctx, canvas, label) {
        const text = String(label || '').trim();
        if (!text) return;

        const w = canvas.width;
        const h = canvas.height;
        const shortSide = Math.min(w, h);
        const fontSize = Math.max(14, Math.round(shortSide * 0.035));

        ctx.save();
        ctx.font = `600 ${fontSize}px Arial, Helvetica, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const textWidth = ctx.measureText(text).width;

        const colStep = Math.max(40, textWidth * 1.9);
        const rowStep = Math.max(40, fontSize * 5.2);
        const angle = -28 * (Math.PI / 180);

        // Low opacity: stroke for definition on light backgrounds, fill for
        // visibility on dark backgrounds. Neither is strong enough to
        // "cross" or interrupt the artwork's own detail.
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = Math.max(1, fontSize * 0.045);
        ctx.globalAlpha = 0.055;

        ctx.rotate(angle);
        // Rotating the context moves the origin's effective coverage; iterate
        // over a generously oversized virtual plane so corners are covered
        // after rotation, then let canvas clipping (implicit, since we only
        // draw within ctx bounds) crop the rest.
        const span = Math.sqrt(w * w + h * h);
        const startY = -span;
        const endY = span;
        const startX = -span;
        const endX = span;

        let rowIndex = 0;
        for (let y = startY; y < endY; y += rowStep) {
            const stagger = (rowIndex % 2 === 0) ? 0 : colStep / 2;
            for (let x = startX + stagger; x < endX; x += colStep) {
                ctx.strokeText(text, x, y);
                ctx.fillText(text, x, y);
            }
            rowIndex++;
        }
        ctx.restore();
    }

    window.VISIBLE_WATERMARK = { applySmartTiledMark };
})();
