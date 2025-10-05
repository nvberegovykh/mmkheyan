/* global CONTENT */
(function(){
    const qs = (sel, el) => (el || document).querySelector(sel);
    const qsa = (sel, el) => Array.from((el || document).querySelectorAll(sel));

    const state = {
        paintings: (CONTENT.paintings || []).map(p => ({...p, type: 'painting'})),
        sculptures: (CONTENT.sculptures || []).map(s => ({...s, type: 'sculpture'})),
        editingIndex: null,
        editingType: 'painting'
    };

    function render() {
        const itemsList = qs('#itemsList');
        itemsList.innerHTML = '';
        const all = [...state.paintings, ...state.sculptures];
        all.forEach((item, idx) => {
            const card = document.createElement('div');
            card.className = 'item';
            const img = document.createElement('img');
            img.src = item.src;
            img.alt = item.name || 'Artwork';
            const meta = document.createElement('div');
            meta.className = 'meta';
            meta.innerHTML = `
                <div class="row"><strong>${item.type}</strong><span>${item.name || ''}</span></div>
                <div class="row"><span>Size</span><span>${item.size || ''}</span></div>
                <div class="row"><span>Material</span><span>${item.material || ''}</span></div>
                <div class="row"><span>Technique</span><span>${item.technique || ''}</span></div>
                <div class="row"><span>Owner</span><span>${item.owner || ''}</span></div>
            `;
            const actions = document.createElement('div');
            actions.className = 'actions';
            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => startEdit(item));
            const delBtn = document.createElement('button');
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', () => removeItem(item));
            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            card.appendChild(img);
            card.appendChild(meta);
            card.appendChild(actions);
            itemsList.appendChild(card);
        });
    }

    function startEdit(item) {
        qs('#itemType').value = item.type;
        qs('#itemName').value = item.name || '';
        qs('#itemSize').value = item.size || '';
        qs('#itemDesc').value = item.description || '';
        qs('#itemMaterial').value = item.material || '';
        qs('#itemTechnique').value = item.technique || '';
        qs('#itemOwner').value = item.owner || '';
        state.editingType = item.type;
        const list = item.type === 'painting' ? state.paintings : state.sculptures;
        state.editingIndex = list.findIndex(i => i.src === item.src);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function removeItem(item) {
        if (!confirm('Delete this item?')) return;
        const list = item.type === 'painting' ? state.paintings : state.sculptures;
        const idx = list.findIndex(i => i.src === item.src);
        if (idx >= 0) list.splice(idx, 1);
        render();
        // Persist immediately so site reflects deletion after reload
        const data = {
            paintings: state.paintings.map(({type, ...rest}) => rest),
            sculptures: state.sculptures.map(({type, ...rest}) => rest),
            settings: {
                contacts: qs('#contactsLink').value.trim() || 'https://www.instagram.com/mygrandpaartist/',
                defaultLang: qs('#defaultLang').value,
                autoTranslate: qs('#autoTranslate').value === 'on'
            }
        };
        localStorage.setItem('content_draft', JSON.stringify(data));
    }

    function addOrUpdate() {
        const type = qs('#itemType').value;
        const name = qs('#itemName').value.trim();
        const size = qs('#itemSize').value.trim();
        const description = qs('#itemDesc').value.trim();
        const material = qs('#itemMaterial').value.trim();
        const technique = qs('#itemTechnique').value.trim();
        const owner = qs('#itemOwner').value.trim();
        const fileInput = qs('#itemFile');
        const urlInput = qs('#itemUrl');

        const targetList = type === 'painting' ? state.paintings : state.sculptures;

        function makeUniqueSrc(srcBase64OrUrl) {
            // If base64, append a short hash to reduce collisions; if URL, leave as-is
            if (srcBase64OrUrl.startsWith('data:')) {
                const hash = Math.random().toString(36).slice(2,8);
                return srcBase64OrUrl + `#${hash}`;
            }
            return srcBase64OrUrl;
        }

        function upsert(srcRaw) {
            const src = makeUniqueSrc(srcRaw);
            const item = { src, name, description, size, material, technique, owner, type };
            if (state.editingIndex != null && state.editingType === type) {
                targetList[state.editingIndex] = item;
            } else {
                targetList.push(item);
            }
            state.editingIndex = null;
            state.editingType = type;
            fileInput.value = '';
            urlInput.value = '';
            render();
        }

        if (fileInput.files && fileInput.files[0]) {
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = () => upsert(reader.result);
            reader.readAsDataURL(file);
        } else if (urlInput.value.trim()) {
            upsert(urlInput.value.trim());
        } else {
            // keep previous src if editing without new file
            if (state.editingIndex != null) {
                const prev = targetList[state.editingIndex];
                upsert(prev.src);
            }
        }
    }

    function exportJson() {
        const data = {
            paintings: state.paintings.map(({type, ...rest}) => rest),
            sculptures: state.sculptures.map(({type, ...rest}) => rest)
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'content.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    function importJson(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                state.paintings = (data.paintings || []).map(p => ({...p, type: 'painting'}));
                state.sculptures = (data.sculptures || []).map(s => ({...s, type: 'sculpture'}));
                render();
            } catch (e) {
                alert('Invalid JSON');
            }
        };
        reader.readAsText(file);
    }

    function wire() {
        qs('#addItem').addEventListener('click', addOrUpdate);
        qs('#exportJson').addEventListener('click', exportJson);
        const importBtn = qs('#importJsonBtn');
        const importInput = qs('#importJson');
        importBtn.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', () => {
            if (importInput.files && importInput.files[0]) importJson(importInput.files[0]);
        });
        // Single Save: update preview AND download content.json for your repo
        const saveAllBtn = qs('#saveAll');
        if (saveAllBtn) saveAllBtn.addEventListener('click', () => {
            const data = {
                paintings: state.paintings.map(({type, ...rest}) => rest),
                sculptures: state.sculptures.map(({type, ...rest}) => rest),
                settings: {
                    contacts: qs('#contactsLink').value.trim() || 'https://www.instagram.com/mygrandpaartist/',
                    defaultLang: qs('#defaultLang').value,
                    autoTranslate: qs('#autoTranslate').value === 'on'
                }
            };
            // Update local preview so you can immediately see site changes during dev
            try { localStorage.setItem('content_draft', JSON.stringify(data)); } catch {}
            // Also download content.json to drop into the project (single click flow)
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'content.json';
            a.click();
            URL.revokeObjectURL(url);
            alert('Saved. Place the downloaded content.json in the site folder to publish to everyone.');
        });

        // utilities
        const clearBtn = qs('#clearPreview');
        if (clearBtn) clearBtn.addEventListener('click', () => {
            if (confirm('Clear local preview content?')) {
                localStorage.removeItem('content_draft');
                alert('Preview cleared. Reload to use built-in content.');
            }
        });
        const reorderBtn = qs('#reorderAlpha');
        if (reorderBtn) reorderBtn.addEventListener('click', () => {
            state.paintings.sort((a,b) => (a.name||'').localeCompare(b.name||''));
            state.sculptures.sort((a,b) => (a.name||'').localeCompare(b.name||''));
            render();
        });
    }

    function init() { 
        // preload settings from draft if present
        try {
            const draft = localStorage.getItem('content_draft');
            if (draft) {
                const data = JSON.parse(draft);
                if (data.paintings) state.paintings = data.paintings.map(p => ({...p, type: 'painting'}));
                if (data.sculptures) state.sculptures = data.sculptures.map(s => ({...s, type: 'sculpture'}));
                if (data.settings) {
                    if (data.settings.contacts) qs('#contactsLink').value = data.settings.contacts;
                    if (data.settings.defaultLang) qs('#defaultLang').value = data.settings.defaultLang;
                    if (typeof data.settings.autoTranslate !== 'undefined') qs('#autoTranslate').value = data.settings.autoTranslate ? 'on' : 'off';
                }
            }
        } catch {}
        render();
        wire(); 
    }
    window.addEventListener('DOMContentLoaded', init);
})();


