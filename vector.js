/* vector.js — lightweight color-region SVG tracer for Palette Mapper
   API:
     await Vectorize.imageDataToSvg(imageData, { palette?: ['#RRGGBB', ...], simplify?: 0.6, scale?: 1 })
*/
(function(){
  const Vectorize = {};
  const HEX = (r,g,b)=>('#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase());
  const eq = (a,b)=>Math.abs(a-b)<1e-6;

  function rgbEq(a,b){ return a[0]===b[0] && a[1]===b[1] && a[2]===b[2]; }

  function toRGB(hex){
    const m = /^#?([0-9a-f]{6})$/i.exec(hex||'');
    if(!m) return null;
    const n = parseInt(m[1],16);
    return [ (n>>16)&255, (n>>8)&255, n&255 ];
  }

  function quantizeToPalette(img, palRGB){
    // Build label map: assign each pixel to nearest palette exact match (we expect exact palette in img already)
    const {width:w,height:h,data:d} = img;
    const lab = new Int16Array(w*h);
    const idxOf = new Map(palRGB.map((rgb,i)=>[HEX(rgb[0],rgb[1],rgb[2]), i]));
    for(let i=0, p=0; i<w*h; i++, p+=4){
      if(d[p+3]===0){ lab[i]=-1; continue; }
      const hex = HEX(d[p],d[p+1],d[p+2]);
      const idx = idxOf.has(hex) ? idxOf.get(hex) : 0;
      lab[i]=idx;
    }
    return lab;
  }

  // Marching Squares on a binary mask -> array of paths (each path = [ [x,y], ... ])
  function traceMask(w,h,mask){
    const visited = new Uint8Array(w*h);
    const paths = [];

    function idx(x,y){ return y*w+x; }
    function isIn(x,y){ return x>=0 && y>=0 && x<w && y<h; }
    function isOn(x,y){ return isIn(x,y) && mask[idx(x,y)]>0; }

    // find start
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const i=idx(x,y);
        if(mask[i] && !visited[i]){
          // walk boundary clockwise
          let cx=x, cy=y, dir=0; // 0=right,1=down,2=left,3=up (edge-follow)
          const path=[];
          let guard=0;
          // move to leftmost/topmost boundary pixel
          while(isOn(cx-1,cy)){ cx--; if(++guard>1e6) break; }
          guard=0;
          let sx=cx, sy=cy, first=true;

          do{
            // record vertex
            path.push([cx,cy]);
            visited[idx(cx,cy)]=1;

            // decide turn using 4-neighborhood
            const right = isOn(cx+1,cy);
            const down  = isOn(cx,cy+1);
            const left  = isOn(cx-1,cy);
            const up    = isOn(cx,cy-1);

            // heuristics: prefer hugging outside
            if(dir===0){ // right →
              if(!right && down){ dir=1; } else if(!right && !down){ dir=2; cx--; } else { cx++; }
            }else if(dir===1){ // down ↓
              if(!down && left){ dir=2; } else if(!down && !left){ dir=3; cy--; } else { cy++; }
            }else if(dir===2){ // left ←
              if(!left && up){ dir=3; } else if(!left && !up){ dir=0; cx++; } else { cx--; }
            }else{ // up ↑
              if(!up && right){ dir=0; } else if(!up && !right){ dir=1; cy++; } else { cy--; }
            }

            if(++guard>1e6) break;
            if(!first && cx===sx && cy===sy) break;
            first=false;
          }while(true);

          // simplify polyline with RDP
          paths.push(simplify(path, 0.6));
        }
      }
    }
    return paths;
  }

  // Ramer–Douglas–Peucker
  function simplify(pts, eps){
    if(pts.length<=3) return pts;
    const keep = new Uint8Array(pts.length); keep[0]=keep[pts.length-1]=1;

    function dpt(a,b,p){
      const [x1,y1]=a,[x2,y2]=b,[x0,y0]=p;
      const A=y2-y1, B=x1-x2, C=x2*y1-x1*y2;
      const num = Math.abs(A*x0 + B*y0 + C);
      const den = Math.hypot(A,B)||1e-9;
      return num/den;
    }
    function rdp(s,e){
      let idx=-1, dmax=0;
      for(let i=s+1;i<e;i++){
        const d = dpt(pts[s], pts[e], pts[i]);
        if(d>dmax){ dmax=d; idx=i; }
      }
      if(dmax>eps){
        rdp(s, idx); rdp(idx, e);
      }else{
        keep[s]=keep[e]=1;
      }
    }
    rdp(0, pts.length-1);
    const out=[]; for(let i=0;i<pts.length;i++) if(keep[i]) out.push(pts[i]);
    return out;
  }

  function pathsToSVG(pathsByColor, w, h, palette){
    const scale = 1;
    const esc = s=>String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
    let out = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">\n`;
    out += `<rect width="100%" height="100%" fill="none"/>\n`;
    for(let c=0;c<pathsByColor.length;c++){
      const hex = palette[c] || '#000000';
      const group = pathsByColor[c];
      if(!group || !group.length) continue;
      out += `  <g fill="${esc(hex)}">\n`;
      for(const path of group){
        if(!path || path.length<3) continue;
        let d = `M ${path[0][0]} ${path[0][1]}`;
        for(let i=1;i<path.length;i++){ d += ` L ${path[i][0]} ${path[i][1]}`; }
        d += ' Z';
        out += `    <path d="${d}"/>\n`;
      }
      out += `  </g>\n`;
    }
    out += `</svg>\n`;
    return out;
  }

  async function imageDataToSvg(imgData, opts={}){
    const w = imgData.width, h = imgData.height;
    let palette = (opts.palette && opts.palette.length) ? opts.palette.slice() : null;

    if(!palette){
      // derive palette from pixels (unique colors up to 32)
      const seen = new Set();
      const d = imgData.data;
      for(let i=0;i<d.length;i+=4){
        if(d[i+3]===0) continue;
        seen.add(HEX(d[i],d[i+1],d[i+2]));
        if(seen.size>32) break;
      }
      palette = [...seen];
    }
    const palRGB = palette.map(toRGB);

    // label map
    const labels = quantizeToPalette(imgData, palRGB);
    // build a mask per color and trace
    const pathsByColor = new Array(palRGB.length).fill(0).map(()=>[]);
    for(let c=0;c<palRGB.length;c++){
      const mask = new Uint8Array(w*h);
      for(let i=0;i<w*h;i++){ mask[i] = (labels[i]===c)?1:0; }
      const paths = traceMask(w,h,mask);
      pathsByColor[c]=paths;
    }
    return pathsToSVG(pathsByColor, w, h, palette);
  }

  Vectorize.imageDataToSvg = imageDataToSvg;
  window.Vectorize = Vectorize;
})();
