/* global firebase, WATERMARK, VISIBLE_WATERMARK, FIREBASE_CONFIG, CLOUDINARY_CONFIG */
(function () {
    const qs = (sel, el) => (el || document).querySelector(sel);
    const qsa = (sel, el) => Array.from((el || document).querySelectorAll(sel));

    // Cloudflare Worker bridge that also hosts the watermark sign/verify API.
    const WORKER_API_BASE = 'https://mmkheyan-web3-bridge.mmkheyan-liber.workers.dev';
    // Long-edge cap for publicly served images. The true original file
    // chosen in the upload dialog is NEVER uploaded or stored anywhere --
    // only this resized, watermarked copy leaves the browser.
    const MAX_LONG_EDGE = 1800;

    // Legacy items store image paths relative to the SITE ROOT (e.g.
    // "paintings/1.png", meant to resolve to /paintings/1.png). This admin
    // page itself lives under /admin/, so assigning that raw string straight
    // to an <img src> makes the browser resolve it relative to /admin/
    // instead, producing a 404 at /admin/paintings/1.png. Root-anchor any
    // relative path so it resolves the same regardless of which page depth
    // it's rendered from. Absolute URLs (http(s):// or Cloudinary links) and
    // already-rooted paths (leading "/") pass through unchanged.
    function resolveAssetUrl(src) {
        if (!src) return src;
        if (/^https?:\/\//i.test(src) || src.startsWith('/') || src.startsWith('data:')) return src;
        return '/' + src.replace(/^\.?\//, '');
    }

    // ---- Firebase init ----
    firebase.initializeApp(FIREBASE_CONFIG);
    const auth = firebase.auth();
    const db = firebase.firestore();

    const state = {
        items: [], // live artworks from Firestore, each has .id
        editingId: null,
        unsub: null
    };

    // ---- Auth gate ----
    function showLogin() {
        qs('#loginScreen').style.display = '';
        qs('#adminMain').style.display = 'none';
        qs('#logoutBtn').style.display = 'none';
    }
    function showAdmin() {
        qs('#loginScreen').style.display = 'none';
        qs('#adminMain').style.display = '';
        qs('#logoutBtn').style.display = '';
    }

    auth.onAuthStateChanged((user) => {
        if (user) {
            showAdmin();
            subscribeArtworks();
            loadSettings();
        } else {
            showLogin();
            if (state.unsub) { state.unsub(); state.unsub = null; }
        }
    });

    qs('#loginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = qs('#loginEmail').value.trim();
        const password = qs('#loginPassword').value;
        const errEl = qs('#loginError');
        errEl.textContent = '';
        auth.signInWithEmailAndPassword(email, password).catch((err) => {
            errEl.textContent = err.message || 'Login failed';
        });
    });

    qs('#logoutBtn').addEventListener('click', () => auth.signOut());

    // ---- Firestore: live artworks ----
    function subscribeArtworks() {
        if (state.unsub) state.unsub();
        state.unsub = db.collection('artworks').orderBy('order', 'asc')
            .onSnapshot((snap) => {
                state.items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                render();
            }, (err) => {
                console.error('Firestore snapshot error', err);
                qs('#uploadStatus').textContent = 'Error loading items: ' + err.message;
            });
    }

    function loadSettings() {
        db.collection('settings').doc('site').get().then((doc) => {
            if (doc.exists) {
                const s = doc.data();
                if (s.defaultLang) qs('#defaultLang').value = s.defaultLang;
                qs('#autoTranslate').value = s.autoTranslate === false ? 'off' : 'on';
            }
        }).catch(() => {});
    }

    qs('#saveSettings').addEventListener('click', () => {
        const data = {
            defaultLang: qs('#defaultLang').value,
            autoTranslate: qs('#autoTranslate').value === 'on'
        };
        db.collection('settings').doc('site').set(data).then(() => {
            qs('#uploadStatus').textContent = 'Settings saved.';
            setTimeout(() => { qs('#uploadStatus').textContent = ''; }, 2000);
        }).catch((err) => {
            qs('#uploadStatus').textContent = 'Settings save failed: ' + err.message;
        });
    });

    // ---- Render items list ----
    function render() {
        const itemsList = qs('#itemsList');
        itemsList.innerHTML = '';
        state.items.forEach((item, idx) => {
            const card = document.createElement('div');
            card.className = 'item';
            const img = document.createElement('img');
            img.src = resolveAssetUrl(item.src);
            img.alt = item.name || 'Artwork';
            const meta = document.createElement('div');
            meta.className = 'meta';
            meta.innerHTML = `
                <div class="row"><strong>${item.type || ''}</strong><span>${item.name || ''}</span></div>
                <div class="row"><span>Size</span><span>${item.size || ''}</span></div>
                <div class="row"><span>Material</span><span>${item.material || ''}</span></div>
                <div class="row"><span>Technique</span><span>${item.technique || ''}</span></div>
                <div class="row"><span>Owner</span><span>${item.owner || ''}</span></div>
            `;
            const actions = document.createElement('div');
            actions.className = 'actions';
            const upBtn = document.createElement('button');
            upBtn.textContent = '↑';
            upBtn.title = 'Move up';
            upBtn.disabled = idx === 0;
            upBtn.addEventListener('click', () => moveItem(idx, -1));
            const downBtn = document.createElement('button');
            downBtn.textContent = '↓';
            downBtn.title = 'Move down';
            downBtn.disabled = idx === state.items.length - 1;
            downBtn.addEventListener('click', () => moveItem(idx, 1));
            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => startEdit(item));
            const delBtn = document.createElement('button');
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', () => removeItem(item));
            actions.appendChild(upBtn);
            actions.appendChild(downBtn);
            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            card.appendChild(img);
            card.appendChild(meta);
            card.appendChild(actions);
            itemsList.appendChild(card);
        });
    }

    function moveItem(idx, dir) {
        const other = idx + dir;
        if (other < 0 || other >= state.items.length) return;
        const a = state.items[idx];
        const b = state.items[other];
        const batch = db.batch();
        batch.update(db.collection('artworks').doc(a.id), { order: b.order });
        batch.update(db.collection('artworks').doc(b.id), { order: a.order });
        batch.commit().catch((err) => alert('Reorder failed: ' + err.message));
    }

    function startEdit(item) {
        qs('#itemType').value = item.type || 'painting';
        qs('#itemName').value = item.name || '';
        qs('#itemSize').value = item.size || '';
        qs('#itemDesc').value = item.description || '';
        qs('#itemMaterial').value = item.material || '';
        qs('#itemTechnique').value = item.technique || '';
        qs('#itemOwner').value = item.owner || '';
        qs('#itemUrl').value = '';
        qs('#itemFile').value = '';
        state.editingId = item.id;
        qs('#cancelEdit').style.display = '';
        qs('#addItem').textContent = 'Update';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function resetForm() {
        state.editingId = null;
        qs('#itemForm').reset();
        qs('#itemType').value = 'painting';
        qs('#cancelEdit').style.display = 'none';
        qs('#addItem').textContent = 'Add / Update';
    }

    qs('#cancelEdit').addEventListener('click', resetForm);

    function removeItem(item) {
        if (!confirm('Delete this item? This removes it from the live site.')) return;
        db.collection('artworks').doc(item.id).delete().catch((err) => {
            alert('Delete failed: ' + err.message);
        });
    }

    // ---- Cloudinary upload with crypto-signed + visible watermark ----
    async function uploadToCloudinary(blob) {
        const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`;
        const form = new FormData();
        form.append('file', blob, 'artwork.png');
        form.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
        form.append('folder', CLOUDINARY_CONFIG.folder);
        const res = await fetch(url, { method: 'POST', body: form });
        if (!res.ok) {
            const text = await res.text();
            throw new Error('Cloudinary upload failed: ' + text);
        }
        const json = await res.json();
        return json.secure_url;
    }

    function visibleWatermarkLabel() {
        return `© MERUZHAN MKHEYAN`;
    }

    /**
     * Save the exact signed/watermarked file to the admin's own machine.
     * Cloudinary is the only remote copy of this file -- if that account,
     * image, or the Firestore doc pointing at it is ever lost, there is
     * otherwise no way to recover the signed original. This makes a local
     * backup automatic on every upload, no extra click required.
     */
    function downloadSignedCopy(blob, sourceFileName) {
        const base = (sourceFileName || 'artwork').replace(/\.[^./]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${base}_signed_${stamp}.png`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function loadImageEl(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
            img.src = url;
        });
    }

    /** Downscale to a long-edge cap on a fresh canvas. Never touches/keeps the original file. */
    function resizeToCanvas(img, maxLongEdge) {
        const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
        const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return { canvas, ctx };
    }

    /** Ask the Worker (admin-only, Firebase-auth-checked) to sign this content digest. */
    async function requestSignature(digestHex, timestamp, nonceHex) {
        const user = auth.currentUser;
        if (!user) throw new Error('Not signed in.');
        const idToken = await user.getIdToken();
        const res = await fetch(`${WORKER_API_BASE}/api/watermark-sign`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({ digestHex, timestamp, nonce: nonceHex }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error('Watermark signing failed: ' + (text || res.status));
        }
        const json = await res.json();
        if (!json.ok || !json.signatureHex) throw new Error('Watermark signing returned no signature.');
        return json.signatureHex;
    }

    /**
     * Runs the full resize -> visible-watermark -> crypto-sign -> embed ->
     * upload pipeline for one file. Pass onProgress(msg) to report status
     * somewhere other than the single-item form's #uploadStatus (used by
     * the batch uploader so each file gets its own progress line instead
     * of everything fighting over one status field).
     */
    async function processFileToSrc(file, onProgress) {
        const report = onProgress || ((msg) => { qs('#uploadStatus').textContent = msg; });

        report('Preparing image...');
        const img = await loadImageEl(file);
        const { canvas, ctx } = resizeToCanvas(img, MAX_LONG_EDGE);

        report('Applying visible signature...');
        VISIBLE_WATERMARK.applySmartTiledMark(ctx, canvas, visibleWatermarkLabel());

        report('Computing content signature...');
        const prepared = await WATERMARK.prepareForSigning(canvas, ctx);
        const timestamp = Date.now();
        const nonceHex = WATERMARK.randomNonceHex();

        report('Requesting cryptographic signature...');
        const signatureHex = await requestSignature(prepared.digestHex, timestamp, nonceHex);

        report('Embedding signature...');
        const watermarked = await WATERMARK.embedSignature(prepared, timestamp, nonceHex, signatureHex);

        report('Saving local backup of signed copy...');
        downloadSignedCopy(watermarked, file.name);

        report('Uploading...');
        const url = await uploadToCloudinary(watermarked);
        report('Uploaded.');
        if (!onProgress) {
            setTimeout(() => { qs('#uploadStatus').textContent = ''; }, 2000);
        }
        return url;
    }

    qs('#itemForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = qs('#itemType').value;
        const name = qs('#itemName').value.trim();
        const size = qs('#itemSize').value.trim();
        const description = qs('#itemDesc').value.trim();
        const material = qs('#itemMaterial').value.trim();
        const technique = qs('#itemTechnique').value.trim();
        const owner = qs('#itemOwner').value.trim();
        const fileInput = qs('#itemFile');
        const urlInput = qs('#itemUrl');
        const status = qs('#uploadStatus');

        let src = null;
        try {
            if (fileInput.files && fileInput.files[0]) {
                src = await processFileToSrc(fileInput.files[0]);
            } else if (urlInput.value.trim()) {
                src = urlInput.value.trim();
            } else if (state.editingId) {
                const existing = state.items.find(i => i.id === state.editingId);
                src = existing ? existing.src : null;
            }
        } catch (err) {
            status.textContent = 'Error: ' + err.message;
            return;
        }

        if (!src) {
            status.textContent = 'Please choose a file or enter an image URL.';
            return;
        }

        const data = { type, name, description, size, material, technique, owner, src };

        try {
            if (state.editingId) {
                await db.collection('artworks').doc(state.editingId).update(data);
            } else {
                const maxOrder = state.items.reduce((m, it) => Math.max(m, it.order || 0), -1);
                data.order = maxOrder + 1;
                await db.collection('artworks').add(data);
            }
            resetForm();
        } catch (err) {
            status.textContent = 'Save failed: ' + err.message;
        }
    });

    // ---- Batch Upload: process many files one after another, no per-file
    // click required. Each successful upload immediately becomes a real
    // Firestore artwork doc (with a placeholder name derived from the
    // filename, everything else blank) so the client can start editing
    // details on already-finished items via the normal "Edit" button
    // while the rest of the batch keeps processing in the background. ----
    const batchForm = qs('#batchForm');
    if (batchForm) {
        batchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const filesInput = qs('#batchFiles');
            const typeSelect = qs('#batchType');
            const status = qs('#batchStatus');
            const progressList = qs('#batchProgressList');
            const submitBtn = qs('#batchUploadBtn');

            const files = Array.from(filesInput.files || []);
            if (!files.length) {
                status.textContent = 'Choose one or more image files first.';
                return;
            }

            const type = typeSelect.value;
            filesInput.disabled = true;
            submitBtn.disabled = true;
            progressList.innerHTML = '';
            status.textContent = `Processing ${files.length} file(s)... you can keep editing items above while this runs.`;

            const rows = files.map((file) => {
                const li = document.createElement('li');
                li.textContent = `${file.name}: queued`;
                progressList.appendChild(li);
                return li;
            });

            // Compute the starting order once up front rather than re-reading
            // state.items each iteration -- the Firestore onSnapshot listener
            // updates state.items asynchronously and may lag behind our own
            // writes within this loop.
            let nextOrder = state.items.reduce((m, it) => Math.max(m, it.order || 0), -1) + 1;
            let completed = 0;
            let failed = 0;

            // Sequential on purpose: keeps per-file progress accurate and
            // avoids hammering the signing endpoint / Cloudinary at once,
            // but nothing here blocks the rest of the admin UI -- items
            // already uploaded show up live and are editable immediately.
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const li = rows[i];
                try {
                    const src = await processFileToSrc(file, (msg) => { li.textContent = `${file.name}: ${msg}`; });
                    const baseName = file.name.replace(/\.[^./]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';
                    await db.collection('artworks').add({
                        type,
                        name: baseName,
                        description: '',
                        size: '',
                        material: '',
                        technique: '',
                        owner: '',
                        src,
                        order: nextOrder++,
                    });
                    li.textContent = `${file.name}: \u2713 uploaded \u2014 edit its details above whenever you're ready`;
                    completed++;
                } catch (err) {
                    li.textContent = `${file.name}: \u2717 failed \u2014 ${err.message}`;
                    failed++;
                }
            }

            status.textContent = `Batch complete: ${completed} uploaded${failed ? `, ${failed} failed` : ''}.`;
            filesInput.value = '';
            filesInput.disabled = false;
            submitBtn.disabled = false;
        });
    }

    // ---- Verify Authenticity tool (public verify endpoint; no admin auth needed) ----
    const verifyForm = qs('#verifyForm');
    if (verifyForm) {
        verifyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const status = qs('#verifyStatus');
            const fileInput = qs('#verifyFile');
            const urlInput = qs('#verifyUrl');
            status.textContent = 'Checking...';
            try {
                const source = (fileInput.files && fileInput.files[0]) ? fileInput.files[0] : urlInput.value.trim();
                if (!source) {
                    status.textContent = 'Choose a file or enter an image URL.';
                    return;
                }
                const extracted = await WATERMARK.extractForVerification(source);
                if (!extracted) {
                    status.textContent = 'No signature found \u2014 not from this gallery, or the image was re-encoded (e.g. re-saved as JPEG) after upload.';
                    return;
                }
                const res = await fetch(`${WORKER_API_BASE}/api/watermark-verify`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        digestHex: extracted.digestHex,
                        timestamp: extracted.timestamp,
                        nonce: extracted.nonceHex,
                        signatureHex: extracted.signatureHex,
                    }),
                });
                const json = await res.json();
                if (json.valid) {
                    const when = new Date(json.embeddedAt).toLocaleString();
                    status.textContent = `\u2713 Genuine \u2014 signed by this gallery on ${when}.`;
                } else {
                    status.textContent = '\u2717 Not genuine \u2014 signature does not match (image was altered, or is not from this gallery).';
                }
            } catch (err) {
                status.textContent = 'Verification error: ' + err.message;
            }
        });
    }
})();
