/* vector.js — minimal vectorization helper
   Exposes: window.Vectorize.fromCanvas(canvas, { simplify, minArea, palette })
   - simplify: 0..1 (more → fewer nodes)
   - minArea: minimum polygon area (px^2)
   - palette: array of HEX strings to restrict fills (optional)
*/
(function(){
  function rgbToHex(r,g,b){ return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase(); }
  function hexEq(a,b){ return (a||'').toUpperCase()===(b||'').toUpperCase(); }

  function simplifyPoly(seq, every){
    if(every<=1) return seq;
    const out=[]; for(let i=0;i<seq.length;i+=every) out.push(seq[i]);
    return out;
  }

  function floodCollect(id,w,h,sx,sy,hx,seen){
    const HEX = i => rgbToHex(id[i],id[i+1],id[i+2]);
    const stack=[[sx,sy]], pts=[];
    const target=hx.toUpperCase();
    seen[sy*w+sx]=1;
    while(stack.length){
      const [x,y]=stack.pop();
      pts.push([x,y]);
      const ns=[[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
      for(const [nx,ny] of ns){
        if(nx<0||ny<0||nx>=w||ny>=h) continue;
        const idx=ny*w+nx; if(seen[idx]) continue;
        const i4=idx*4; if(HEX(i4)!==target) continue;
        seen[idx]=1; stack.push([nx,ny]);
      }
    }
    return pts;
  }

  function polygonArea(pts){
    let a=0; for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const [x1,y1]=pts[j], [x2,y2]=pts[i]; a += (x1*y2 - x2*y1);
    } return Math.abs(a/2);
  }

  async function fromCanvas(canvas, opts={}){
    const { simplify=0.35, minArea=8, palette=null } = opts;
    const w=canvas.width, h=canvas.height;
    const ctx=canvas.getContext('2d');
    const img=ctx.getImageData(0,0,w,h).data;
    const seen=new Uint8Array(w*h);
    const HEX = (i)=> rgbToHex(img[i],img[i+1],img[i+2]);

    const paths=[];
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        const idx=y*w+x; if(seen[idx]) continue;
        const i4=idx*4; const hx=HEX(i4);
        if(palette && palette.length && !palette.some(p=>hexEq(p,hx))) { seen[idx]=1; continue; }
        const pts=floodCollect(img,w,h,x,y,hx,seen);
        if(pts.length<3) continue;
        const area=polygonArea(pts);
        if(area<minArea) continue;
        const step = Math.max(1, Math.floor((1-simplify)*8));
        const simp = simplifyPoly(pts, step).map(p=>p.join(',')).join(' ');
        paths.push(`<polygon points="${simp}" fill="${hx}" stroke="none"/>`);
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${paths.join('')}</svg>`;
  }

  window.Vectorize = { fromCanvas };
})();
