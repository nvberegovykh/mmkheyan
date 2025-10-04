/* global CONTENT, I18N */
(function () {
    const qs = (sel, el) => (el || document).querySelector(sel);
    const qsa = (sel, el) => Array.from((el || document).querySelectorAll(sel));

    const state = {
        lang: 'en',
        paintings: [],
        sculptures: []
    };

    function randomPaintingSrc() {
        const list = state.paintings.length ? state.paintings : (CONTENT.paintings || []);
        if (!list.length) return 'paintings/1.png';
        const item = list[Math.floor(Math.random() * list.length)];
        return item.src;
    }

    function initPinned() {
        const pinned = qs('#pinnedImage');
        // show placeholder while loading
        const placeholder = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="white"/></svg>';
        pinned.src = placeholder;
        const randSrc = encodeURI(randomPaintingSrc());
        const loader = new Image();
        loader.onload = () => { pinned.src = randSrc; };
        loader.onerror = () => { pinned.src = 'paintings/1.png'; };
        loader.src = randSrc;
        pinned.style.visibility = 'visible';
        pinned.style.opacity = '1';
        pinned.style.zIndex = '1';
        const handleDrop = () => {
            const overlay = document.getElementById('introOverlay');
            overlay.classList.add('fade-out');
            setTimeout(() => {
                overlay.remove();
                document.body.classList.remove('intro-active');
                const tb = document.querySelector('.topbar');
                if (tb) tb.style.display = 'block';
                revealParallax();
                // land at absolute top; no auto-scroll to sections
                window.scrollTo({ top: 0, behavior: 'auto' });
            }, 500);
        };
        pinned.addEventListener('click', handleDrop, { passive: true });
        qs('#enterGallery').addEventListener('click', handleDrop);
    }

    function createCard(item) {
        const card = document.createElement('div');
        card.className = 'card';
        const img = document.createElement('img');
        img.src = item.src;
        img.alt = item.name || 'Artwork';
        const meta = document.createElement('div');
        meta.className = 'meta';
        const titleEl = document.createElement('div');
        titleEl.className = 'title';
        titleEl.textContent = item.name || '';
        meta.appendChild(titleEl);
        if (item.description) {
            const desc = document.createElement('div');
            desc.className = 'desc';
            desc.textContent = item.description;
            meta.appendChild(desc);
            if (state.autoTranslate && window.TRANSLATE && state.lang) {
                TRANSLATE.translateText(desc.textContent, state.lang).then(t => { if (desc.isConnected) desc.textContent = t; }).catch(()=>{});
            }
        }
        card.appendChild(img);
        card.appendChild(meta);
        card.addEventListener('click', () => openLightbox(item));
        // apply auto-translation if enabled (non-blocking)
        if (state.autoTranslate && window.TRANSLATE) {
            const lang = state.lang;
            if (lang) {
                const original = titleEl.textContent;
                TRANSLATE.translateText(original, lang).then(t => {
                    if (titleEl.isConnected) titleEl.textContent = t;
                }).catch(()=>{});
            }
        }
        return card;
    }

    function populateGalleries() {
        const pg = qs('#paintingsGrid');
        const sg = qs('#sculpturesGrid');
        pg.innerHTML = '';
        sg.innerHTML = '';
        // robust append even if duplicate names or base64 images
        state.paintings.forEach((p, idx) => {
            const card = createCard({ ...p, id: p.id || `p-${idx}` });
            pg.appendChild(card);
        });
        state.sculptures.forEach((s, idx) => {
            const card = createCard({ ...s, id: s.id || `s-${idx}` });
            sg.appendChild(card);
        });
        setupParallax([pg, sg]);
    }

    async function openLightbox(item) {
        const lb = qs('#lightbox');
        qs('#lightboxImage').src = item.src;
        const baseMeta = [
            ['title', item.name],
            ['type', item.type],
            ['size', item.size],
            ['material', item.material],
            ['technique', item.technique],
            ['owner', item.owner]
        ].filter(([,v]) => v);
        const metaEl = qs('#lightboxMeta');
        metaEl.innerHTML = baseMeta.map(([k,v]) => `<div><strong>${k}:</strong> ${v}</div>`).join('');

        if (state.autoTranslate && window.TRANSLATE && state.lang) {
            try {
                const values = await Promise.all(baseMeta.map(([_,v]) => TRANSLATE.translateText(String(v), state.lang)));
                const translated = baseMeta.map(([k], i) => [k, values[i]]);
                metaEl.innerHTML = translated.map(([k,v]) => `<div><strong>${k}:</strong> ${v}</div>`).join('');
            } catch {}
        }
        lb.classList.add('open');
        lb.setAttribute('aria-hidden', 'false');
    }

    function closeLightbox() {
        const lb = qs('#lightbox');
        lb.classList.remove('open');
        lb.setAttribute('aria-hidden', 'true');
    }

    function wireLightbox() {
        qs('#lightboxClose').addEventListener('click', closeLightbox);
        qs('#lightbox').addEventListener('click', (e) => {
            if (e.target.id === 'lightbox') closeLightbox();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeLightbox();
        });
    }

    function wireNav() {
        qsa('.nav-link').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-target');
                document.querySelector(target).scrollIntoView({ behavior: 'smooth' });
            });
        });
    }

    function applyI18n() {
        const lang = state.lang;
        const t = I18N[lang] || I18N.en;
        document.title = t.title;
        const navLinks = qsa('.nav-link');
        if (navLinks[0]) navLinks[0].textContent = t.paintingsNav;
        if (navLinks[1]) navLinks[1].textContent = t.sculpturesNav;
        qs('.brand').textContent = t.brand;
        qs('#paintings').textContent = t.paintings;
        qs('#sculptures').textContent = t.sculptures;
        qs('#contactLink').textContent = t.contacts;
        qs('#auctionsLink').textContent = t.auctions;
        qs('#privacyLink').textContent = t.privacy;
        qs('#termsLink').textContent = t.terms;
    }

    function wireLang() {
        const select = qs('#langSelect');
        const prev = state.lang;
        const saved = localStorage.getItem('lang');
        if (saved) state.lang = saved; else {
            const browser = (navigator.language || 'en').slice(0,2);
            if (['en','ru','ka'].includes(browser)) state.lang = browser;
        }
        select.value = state.lang;
        if (prev !== state.lang) {
            // align UI and galleries to initial language
            applyI18n();
            populateGalleries();
            revealParallax();
        }
        select.addEventListener('change', () => {
            state.lang = select.value;
            localStorage.setItem('lang', state.lang);
            applyI18n();
            populateGalleries();
            revealParallax();
        });
    }

    function setupParallax(grids) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) entry.target.classList.add('visible');
            });
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.06 });
        grids.forEach(grid => {
            qsa('.card', grid).forEach(card => observer.observe(card));
        });
        // removed cursor-follow effect
    }

    function revealParallax() {
        qsa('.parallax .card').forEach(card => card.classList.add('visible'));
    }

    async function loadContent() {
        // 1) Local draft from admin preview
        try {
            const draft = localStorage.getItem('content_draft');
            if (draft) {
                const data = JSON.parse(draft);
                const dp = (data.paintings || []).map(it => ({ ...it, type: 'painting' }));
                const ds = (data.sculptures || []).map(it => ({ ...it, type: 'sculpture' }));
                if (dp.length || ds.length) {
                    state.paintings = dp.length ? dp : (CONTENT.paintings || []).map(it => ({ ...it, type: 'painting' }));
                    state.sculptures = ds.length ? ds : (CONTENT.sculptures || []).map(it => ({ ...it, type: 'sculpture' }));
                } else {
                    // fallback if draft is empty
                    state.paintings = (CONTENT.paintings || []).map(it => ({ ...it, type: 'painting' }));
                    state.sculptures = (CONTENT.sculptures || []).map(it => ({ ...it, type: 'sculpture' }));
                }
                if (data.settings) {
                    if (data.settings.contacts) {
                        const link = document.getElementById('contactLink');
                        link.href = data.settings.contacts;
                    }
                    if (data.settings.defaultLang && ['en','ru','ka'].includes(data.settings.defaultLang)) {
                        state.lang = data.settings.defaultLang;
                    }
                    // default to ON unless explicitly disabled
                    state.autoTranslate = data.settings.autoTranslate === false ? false : true;
                }
                return;
            }
        } catch {}

        // 2) content.json if present (static deployment)
        try {
            const res = await fetch('content.json', { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                const dp = (data.paintings || []).map(it => ({ ...it, type: 'painting' }));
                const ds = (data.sculptures || []).map(it => ({ ...it, type: 'sculpture' }));
                state.paintings = dp.length ? dp : (CONTENT.paintings || []).map(it => ({ ...it, type: 'painting' }));
                state.sculptures = ds.length ? ds : (CONTENT.sculptures || []).map(it => ({ ...it, type: 'sculpture' }));
                if (data.settings && data.settings.contacts) {
                    const link = document.getElementById('contactLink');
                    link.href = data.settings.contacts;
                }
                if (data.settings) {
                    state.autoTranslate = data.settings.autoTranslate === false ? false : true;
                } else {
                    state.autoTranslate = true;
                }
                return;
            }
        } catch {}

        // 3) Fallback to embedded CONTENT
        state.paintings = (CONTENT.paintings || []).map(it => ({ ...it, type: 'painting' }));
        state.sculptures = (CONTENT.sculptures || []).map(it => ({ ...it, type: 'sculpture' }));
        state.autoTranslate = true;
    }

    function setYear() {
        const el = document.getElementById('year');
        el.textContent = new Date().getFullYear();
    }

    async function init() {
        setYear();
        await loadContent();
        initPinned();
        populateGalleries();
        // ensure cards are visible even if observer didn't fire while hidden
        revealParallax();
        wireLightbox();
        wireNav();
        wireLang();
        applyI18n();
    }

    window.addEventListener('DOMContentLoaded', init);
})();


