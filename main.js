/* global CONTENT, I18N */
(function () {
    const qs = (sel, el) => (el || document).querySelector(sel);
    const qsa = (sel, el) => Array.from((el || document).querySelectorAll(sel));

    // ---- Download deterrents for artwork images ----
    // Browsers must always receive the raw image bytes to display them, so
    // no client-side technique can make an image *impossible* to save (a
    // determined visitor can still use devtools/network tab). What this
    // does block is every casual path: right-click > Save Image As, dragging
    // the image to the desktop, and iOS/Android long-press > Save Image.
    // Applied to the intro artwork, every gallery thumbnail, and the
    // full-size lightbox image (invisible per-file provenance watermarking
    // handles the case where someone does get past this — see admin.js).
    // Best-effort attempt log. Fires a tiny, fire-and-forget beacon to the
    // Web3 bridge Worker (same-origin relative path) so the owner has a
    // record of who tried to grab a full-size artwork and when. Silently
    // no-ops when served directly from GitHub Pages (no such route there)
    // or when the beacon fails for any reason — tracking must never be able
    // to break the gallery itself.
    function trackAttempt(action, label) {
        try {
            const payload = JSON.stringify({ action, image: label || null, page: location.pathname, ts: Date.now() });
            if (navigator.sendBeacon) {
                const blob = new Blob([payload], { type: 'application/json' });
                navigator.sendBeacon('/api/track-attempt', blob);
            } else {
                fetch('/api/track-attempt', { method: 'POST', body: payload, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
            }
        } catch {}
    }

    function protectImage(img, label) {
        img.draggable = false;
        img.setAttribute('draggable', 'false');
        img.addEventListener('contextmenu', (e) => { e.preventDefault(); trackAttempt('contextmenu', label || img.dataset.label); });
        img.addEventListener('dragstart', (e) => { e.preventDefault(); trackAttempt('dragstart', label || img.dataset.label); });
    }
    // Wraps an image in a positioned container plus a transparent "shield"
    // div on top of it. Right-clicks/long-presses then land on the shield
    // (a plain <div>), so the browser never even offers an image-specific
    // save option — it shows the generic page context menu instead, or
    // nothing at all now that contextmenu is also preventDefault'd on it.
    function shieldImage(img, label) {
        protectImage(img, label);
        const wrap = document.createElement('div');
        wrap.className = 'artwork-shield-wrap';
        if (img.parentNode) img.replaceWith(wrap); // in-place (e.g. static #lightboxImage)
        wrap.appendChild(img);
        const shield = document.createElement('div');
        shield.className = 'artwork-shield';
        shield.addEventListener('contextmenu', (e) => { e.preventDefault(); trackAttempt('contextmenu', label || img.dataset.label); });
        shield.addEventListener('dragstart', (e) => { e.preventDefault(); trackAttempt('dragstart', label || img.dataset.label); });
        wrap.appendChild(shield);
        return wrap;
    }

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
        protectImage(pinned); // no shield here: the image itself is the "click to enter" trigger
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
        }
        const shieldedImg = shieldImage(img, item.name || item.src); // click still bubbles up to the card listener below
        card.appendChild(shieldedImg);
        card.appendChild(meta);
        card.addEventListener('click', () => openLightbox(item));
        // apply auto-translation only to title (non-blocking)
        if (state.autoTranslate && window.TRANSLATE) {
            const lang = state.lang;
            if (lang) {
                if (item.name) {
                    TRANSLATE.translateText(item.name, lang).then(t => {
                        if (titleEl.isConnected) titleEl.textContent = t;
                    }).catch(()=>{});
                }
                if (item.description && meta.querySelector('.desc')) {
                    const descEl = meta.querySelector('.desc');
                    TRANSLATE.translateText(item.description, lang).then(t => {
                        if (descEl && descEl.isConnected) descEl.textContent = t;
                    }).catch(()=>{});
                }
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
        const lbImg = qs('#lightboxImage');
        lbImg.src = item.src;
        lbImg.dataset.label = item.name || item.src;
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
        shieldImage(qs('#lightboxImage'), 'lightbox'); // protect the highest-resolution view; per-open label set in openLightbox
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
        // burger / overlay
        const overlay = qs('#menuOverlay');
        const burger = qs('#burgerBtn');
        const closeBtn = qs('#menuClose');
        function openMenu(){ overlay.classList.add('open'); burger.setAttribute('aria-expanded','true'); document.body.style.overflow='hidden'; }
        function closeMenu(){ overlay.classList.remove('open'); burger.setAttribute('aria-expanded','false'); document.body.style.overflow=''; }
        if (burger) burger.addEventListener('click', openMenu);
        if (closeBtn) closeBtn.addEventListener('click', closeMenu);
        overlay?.addEventListener('click', (e) => { if (e.target.id === 'menuOverlay') closeMenu(); });
        // mobile menu navigation and language
        qsa('.menu-item').forEach(btn => btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-target');
            closeMenu();
            setTimeout(() => document.querySelector(target).scrollIntoView({ behavior: 'smooth' }), 50);
        }));
        const langMobile = qs('#langSelectMobile');
        if (langMobile) {
            langMobile.value = state.lang;
            langMobile.addEventListener('change', () => {
                state.lang = langMobile.value; localStorage.setItem('lang', state.lang);
                qs('#langSelect').value = state.lang; applyI18n(); populateGalleries(); revealParallax();
            });
        }
    }

    function applyI18n() {
        const lang = state.lang;
        const t = I18N[lang] || I18N.en;
        document.title = t.title;
        const navLinks = qsa('.nav-link');
        if (navLinks[0]) navLinks[0].textContent = t.paintingsNav;
        if (navLinks[1]) navLinks[1].textContent = t.sculpturesNav;
        qs('.brand').textContent = t.brand;
        // mobile overlay texts
        const mb = qs('#menuBrand');
        if (mb) mb.textContent = t.brand;
        const mlp = qs('#paintingsLinkMobile');
        if (mlp) mlp.textContent = t.paintingsNav;
        const mls = qs('#sculpturesLinkMobile');
        if (mls) mls.textContent = t.sculpturesNav;
        const lsm = qs('#langSelectMobile');
        if (lsm) lsm.value = state.lang;
        qs('#paintings').textContent = t.paintings;
        qs('#sculptures').textContent = t.sculptures;
        qs('#privacyLink').textContent = t.privacy;
        qs('#termsLink').textContent = t.terms;
    }

    function wireLang() {
        const select = qs('#langSelect');
        const prev = state.lang;
        const saved = localStorage.getItem('lang');
        if (saved) state.lang = saved; else {
            const browser = (navigator.language || 'en').slice(0,2);
            if (['en','ru','ka','hy'].includes(browser)) state.lang = browser;
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

    async function loadFromFirestore() {
        if (!window.firebase || !window.FIREBASE_CONFIG) return false;
        try {
            if (!firebase.apps || !firebase.apps.length) {
                firebase.initializeApp(window.FIREBASE_CONFIG);
            }
            const db = firebase.firestore();
            const snap = await db.collection('artworks').orderBy('order', 'asc').get();
            if (snap.empty) return false;
            const all = snap.docs.map(d => d.data());
            state.paintings = all.filter(it => it.type === 'painting');
            state.sculptures = all.filter(it => it.type === 'sculpture');
            try {
                const settingsDoc = await db.collection('settings').doc('site').get();
                if (settingsDoc.exists) {
                    const s = settingsDoc.data();
                    if (s.defaultLang && ['en','ru','ka'].includes(s.defaultLang)) {
                        state.lang = s.defaultLang;
                    }
                    state.autoTranslate = s.autoTranslate === false ? false : true;
                } else {
                    state.autoTranslate = true;
                }
            } catch {
                state.autoTranslate = true;
            }
            return true;
        } catch (e) {
            console.warn('Firestore load failed, falling back', e);
            return false;
        }
    }

    async function loadContent() {
        // 1) Live data from Firestore (primary source, kept in sync via admin panel)
        try {
            const ok = await loadFromFirestore();
            if (ok) return;
        } catch {}

        // 2) content.json if present (static deployment fallback)
        try {
            const res = await fetch('content.json', { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                const dp = (data.paintings || []).map(it => ({ ...it, type: 'painting' }));
                const ds = (data.sculptures || []).map(it => ({ ...it, type: 'sculpture' }));
                state.paintings = dp.length ? dp : (CONTENT.paintings || []).map(it => ({ ...it, type: 'painting' }));
                state.sculptures = ds.length ? ds : (CONTENT.sculptures || []).map(it => ({ ...it, type: 'sculpture' }));
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


