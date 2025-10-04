/* Content model - initial content is mapped from discovered assets. */
/* The user prefers no secrets in code; credentials should be elsewhere. */
/* global window */
(function () {
    const paintings = [
        { src: 'paintings/1.png', name: 'Painting 1' },
        { src: 'paintings/2.png', name: 'Painting 2' },
        { src: 'paintings/3.png', name: 'Painting 3' },
        { src: 'paintings/Дыхание весны.png', name: 'Дыхание весны' },
        { src: 'paintings/Менделеев.png', name: 'Менделеев' },
        { src: 'paintings/Моцарт и Музы.png', name: 'Моцарт и Музы' },
        { src: 'paintings/Осенний ветер.png', name: 'Осенний ветер' },
        { src: 'paintings/Субботнее утро.png', name: 'Субботнее утро' },
        { src: 'paintings/Утро.png', name: 'Утро' }
    ];

    const sculptures = [
        { src: 'sculptures/1.png', name: 'Sculpture 1' },
        { src: 'sculptures/2.png', name: 'Sculpture 2' },
        { src: 'sculptures/3.png', name: 'Sculpture 3' },
        { src: 'sculptures/4.png', name: 'Sculpture 4' },
        { src: 'sculptures/Медаль.png', name: 'Медаль' }
    ];

    window.CONTENT = { paintings, sculptures };
})();



