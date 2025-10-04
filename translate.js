(function(){
    const CACHE_KEY = 'translation_cache_v1';
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { cache = {}; }

    async function translateText(text, targetLang){
        if (!text || !targetLang) return text;
        const key = targetLang + ':' + text;
        if (cache[key]) return cache[key];
        try {
            const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + encodeURIComponent(targetLang) + '&dt=t&q=' + encodeURIComponent(text);
            const res = await fetch(url);
            const data = await res.json();
            const translated = (data && data[0]) ? data[0].map(p => p[0]).join('') : text;
            cache[key] = translated;
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
            return translated;
        } catch {
            return text; // graceful fallback
        }
    }

    window.TRANSLATE = { translateText };
})();


