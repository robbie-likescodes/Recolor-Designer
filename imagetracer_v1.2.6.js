/* imagetracer_v1.2.6.js — tiny shim for Palette Mapper
   Replace this file with the official ImageTracer (https://github.com/jankovicsandras/imagetracerjs)
   if you want the full feature set. This shim exposes imagedataToSVG() using Vectorize.
*/
(function(){
  if (window.ImageTracer) return;
  window.ImageTracer = {
    getoptions(){ return {}; },
    imagedataToSVG(imgData /*, opts*/){
      if (window.Vectorize && typeof window.Vectorize.imageDataToSvg === 'function'){
        // synchronous bridge via async wrapper
        var svg = null, err=null, done=false;
        window.Vectorize.imageDataToSvg(imgData).then(s=>{ svg=s; done=true; }).catch(e=>{ err=e; done=true; });
        // naive spin wait for small images (keeps interface compatible)
        var t0=Date.now();
        while(!done && Date.now()-t0<2000) {}
        if (svg) return svg;
        throw (err || new Error('Vectorize failed'));
      }
      throw new Error('Vector back-end not available. Include vector.js or the official ImageTracer build.');
    }
  };
})();
