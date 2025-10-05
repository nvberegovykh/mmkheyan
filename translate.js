(function(){
    // In-memory cache only (no local persistence)
    const cache = {};
    function save(key, value){ cache[key] = value; }

    const useProxy = /github\.io$/.test(location.hostname);
    const proxy = (url) => useProxy ? 'https://cors.isomorphic-git.org/' + url : url;

    async function googleTranslate(text, targetLang){
        const url = proxy('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + encodeURIComponent(targetLang) + '&dt=t&q=' + encodeURIComponent(text));
        const res = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
        if (!res.ok) throw new Error('google-fail');
        const data = await res.json();
        return (data && data[0]) ? data[0].map(p => p[0]).join('') : text;
    }

    async function myMemoryTranslate(text, targetLang){
        const url = proxy('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent('auto|' + targetLang));
        const res = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
        if (!res.ok) throw new Error('mymemory-fail');
        const data = await res.json();
        return (data && data.responseData && data.responseData.translatedText) ? data.responseData.translatedText : text;
    }

    async function translateText(text, targetLang){
        if (!text || !targetLang) return text;
        const key = targetLang + ':' + text;
        if (cache[key]) return cache[key];
        try {
            const out = await Promise.race([
                googleTranslate(text, targetLang),
                new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), 2500))
            ]);
            save(key, out);
            return out;
        } catch (e) {
            try {
                const out = await Promise.race([
                    myMemoryTranslate(text, targetLang),
                    new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout2')), 3000))
                ]);
                save(key, out);
                return out;
            } catch {
                try {
                    const libreUrl = useProxy ? 'https://cors.isomorphic-git.org/https://libretranslate.de/translate' : 'https://libretranslate.de/translate';
                    const res = await fetch(libreUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Accept':'application/json' },
                        body: JSON.stringify({ q: text, source: 'auto', target: targetLang, format: 'text' })
                    });
                    if (!res.ok) throw new Error('libre-fail');
                    const data = await res.json();
                    const out = data.translatedText || text;
                    save(key, out);
                    return out;
                } catch {
                    return text; // last resort
                }
            }
        }
    }

    window.TRANSLATE = { translateText };
})();


