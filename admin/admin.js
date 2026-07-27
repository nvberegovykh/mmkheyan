/* global firebase, WATERMARK, FIREBASE_CONFIG, CLOUDINARY_CONFIG */
(function () {
    const qs = (sel, el) => (el || document).querySelector(sel);
    const qsa = (sel, el) => Array.from((el || document).querySelectorAll(sel));

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
                if (s.contacts) qs('#contactsLink').value = s.contacts;
                if (s.defaultLang) qs('#defaultLang').value = s.defaultLang;
                qs('#autoTranslate').value = s.autoTranslate === false ? 'off' : 'on';
            }
        }).catch(() => {});
    }

    qs('#saveSettings').addEventListener('click', () => {
        const data = {
            contacts: qs('#contactsLink').value.trim() || 'https://www.instagram.com/mygrandpaartist/',
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

    // ---- Cloudinary upload with invisible watermark ----
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

    function watermarkText() {
        return `© Meruzhan Mkheyan ${new Date().getFullYear()}`;
    }

    async function processFileToSrc(file) {
        const status = qs('#uploadStatus');
        status.textContent = 'Embedding watermark...';
        const watermarked = await WATERMARK.embedWatermark(file, watermarkText());
        status.textContent = 'Uploading...';
        const url = await uploadToCloudinary(watermarked);
        status.textContent = 'Uploaded.';
        setTimeout(() => { status.textContent = ''; }, 2000);
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
})();
