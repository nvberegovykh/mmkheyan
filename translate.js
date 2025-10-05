(function(){
    const CACHE_KEY = 'translation_cache_v2';
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { cache = {}; }

    function save(key, value){
        cache[key] = value;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
    }

    async function googleTranslate(text, targetLang){
        const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + encodeURIComponent(targetLang) + '&dt=t&q=' + encodeURIComponent(text);
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error('google-fail');
        const data = await res.json();
        return (data && data[0]) ? data[0].map(p => p[0]).join('') : text;
    }

    async function myMemoryTranslate(text, targetLang){
        const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent('auto|' + targetLang);
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error('mymemory-fail');
        const data = await res.json();
        return (data && data.responseData && data.responseData.translatedText) ? data.responseData.translatedText : text;
    }

    async function translateText(text, targetLang){
        if (!text || !targetLang) return text;
        const key = targetLang + ':' + text;
        if (cache[key]) return cache[key];
        try {
            const out = await googleTranslate(text, targetLang);
            save(key, out);
            return out;
        } catch (e) {
            try {
                const out = await myMemoryTranslate(text, targetLang);
                save(key, out);
                return out;
            } catch {
                return text; // last resort
            }
        }
    }

    window.TRANSLATE = { translateText };
})();


