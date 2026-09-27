(() => {
  'use strict';

  function cropStyle(img, xValue, yValue, zoomValue) {
    const clamp=(value,min,max,fallback)=>{
      const number=Number(value);
      return Math.max(min,Math.min(max,Number.isFinite(number)?number:fallback));
    };
    const x=clamp(xValue,0,100,50);
    const y=clamp(yValue,0,100,50);
    const zoom=clamp(zoomValue,50,250,100)/100;
    const tx=Math.round((x-50)*1000)/1000;
    const ty=Math.round((y-50)*1000)/1000;

    const important = (name,value) => img.style.setProperty(name,value,'important');
    important('position','absolute');
    important('inset','0');
    important('left','0');
    important('top','0');
    important('right','0');
    important('bottom','0');
    important('width','100%');
    important('height','100%');
    important('max-width','none');
    important('object-fit','cover');
    important('object-position','50% 50%');
    important('transform','translate('+tx+'%,'+ty+'%) scale('+zoom+')');
    important('transform-origin','50% 50%');
  }

  function configFor(section) {
    try {
      return JSON.parse(decodeURIComponent(section.dataset.writerConfig || ''));
    } catch {
      return null;
    }
  }

  function hydrateSection(section) {
    const config=configFor(section);
    if (!config) return;
    const pairs=[
      [section.querySelector('.fc-left .fc-portrait img'),config.a],
      [section.querySelector('.fc-right .fc-portrait img'),config.b]
    ];
    for (const [img,fighter] of pairs) {
      if (!img || !fighter) continue;
      cropStyle(img,fighter.x ?? 50,fighter.y ?? 50,fighter.zoom ?? 100);
    }
  }

  function hydrate(root=document) {
    if (root.matches?.('section[data-writer-block="tale"]')) hydrateSection(root);
    root.querySelectorAll?.('section[data-writer-block="tale"]').forEach(hydrateSection);
  }

  hydrate();

  let timer=0;
  const observer=new MutationObserver(mutations=>{
    const roots=[];
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType===1) roots.push(node);
      }
    }
    if (!roots.length) return;
    clearTimeout(timer);
    timer=setTimeout(()=>roots.forEach(hydrate),20);
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
