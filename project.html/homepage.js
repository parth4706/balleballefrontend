
  (function(){
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clampDPR = () => Math.min(Math.max(window.devicePixelRatio || 1, 1), 2.25);

    const glCanvas = document.querySelector('.webgl');
    const fbCanvas = document.querySelector('.fallback');

    let renderer, scene, camera, sphere, stars, uniforms, rafId = 0, start = performance.now();
    let mouse = new THREE.Vector2(0.5, 0.5), targetMouse = new THREE.Vector2(0.5, 0.5);
    let tilt = new THREE.Vector2(0,0);

    // Title interaction state
const root = document.documentElement;
const stageEl = document.querySelector('.stage');
const titleEl = document.querySelector('.name');

let titleTarget = new THREE.Vector2(0.5, 0.5);
let titleCurrent = new THREE.Vector2(0.5, 0.5);
let hoverCurrent = 0.0;
let hoverTarget = 0.0;

    function initWebGL(){
      try{
        renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(clampDPR());
        renderer.setSize(glCanvas.clientWidth || window.innerWidth, glCanvas.clientHeight || window.innerHeight, false);
        renderer.setClearColor(0x070a11, 1);

        scene = new THREE.Scene();

        // Camera
        const aspect = (glCanvas.clientWidth || window.innerWidth) / (glCanvas.clientHeight || window.innerHeight);
        camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 100);
        camera.position.set(0, 0, 6);

        // Sphere with custom shader (glow + organic flow)
        const geo = new THREE.IcosahedronGeometry(1.45, 6);
        uniforms = {
          u_time:   { value: 0 },
          u_mouse:  { value: new THREE.Vector2(0.5, 0.5) },
          u_res:    { value: new THREE.Vector2(glCanvas.width, glCanvas.height) },
          u_accent: { value: new THREE.Color(0xff5a3d) },
          u_accent2:{ value: new THREE.Color(0x52c7ff) },
          u_motion: { value: prefersReduced ? 0.0 : 1.0 }
        };

        const vsh = `
          varying vec3 v_pos;
          varying vec3 v_norm;
          void main(){
            v_pos = position;
            v_norm = normalMatrix * normal;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `;

        const fsh = `
          precision highp float;
          varying vec3 v_pos;
          varying vec3 v_norm;

          uniform float u_time;
          uniform vec2  u_mouse;
          uniform vec3  u_accent;
          uniform vec3  u_accent2;
          uniform float u_motion;

          // hash/noise (iq)
          float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1,0.2,0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
          float noise(vec3 x){
            vec3 p = floor(x), f = fract(x);
            f = f*f*(3.0-2.0*f);
            float n = mix(mix(mix(hash(p+vec3(0,0,0)), hash(p+vec3(1,0,0)), f.x),
                              mix(hash(p+vec3(0,1,0)), hash(p+vec3(1,1,0)), f.x), f.y),
                          mix(mix(hash(p+vec3(0,0,1)), hash(p+vec3(1,0,1)), f.x),
                              mix(hash(p+vec3(0,1,1)), hash(p+vec3(1,1,1)), f.x), f.y), f.z);
            return n;
          }

          vec3 tonemap(vec3 c){
            // simple filmic-ish
            c = max(vec3(0.0), c - 0.004);
            return (c * (6.2*c + 0.5)) / (c * (6.2*c + 1.7) + 0.06);
          }

          void main(){
            // Normal-based lighting
            vec3 N = normalize(v_norm);
            vec3 V = normalize(-v_pos);
            vec3 L1 = normalize(vec3(0.6, 0.8, 0.5));
            vec3 L2 = normalize(vec3(-0.7, -0.2, 0.6));

            // Mouse-driven color bias
            float mAngle = (u_mouse.x - 0.5) * 3.14159;
            vec3 bias = mix(u_accent2, u_accent, 0.5 + 0.5*sin(mAngle));

            // Flowing emissive veins
            float t = u_time * (0.6*u_motion + 0.02);
            float n = 0.0;
            vec3 p = normalize(v_pos) * 2.5;
            n += 0.55 * noise(p + vec3(t, 0.0, -t));
            n += 0.30 * noise(p*2.0 + vec3(-t*1.4, t*1.1, t*0.7));
            n += 0.15 * noise(p*4.0 + vec3(t*0.7, -t*1.3, t*0.9));
            n = smoothstep(0.45, 0.85, n);

            // Rim glow
            float rim = pow(1.0 - max(dot(N, V), 0.0), 2.2);

            // Diffuse + spec-ish
            float diff = max(dot(N, L1), 0.0) * 0.8 + max(dot(N, L2), 0.0) * 0.4;
            float spec = pow(max(dot(reflect(-L1, N), V), 0.0), 24.0) * 0.5;

            vec3 base = mix(vec3(0.02,0.04,0.08), vec3(0.05,0.08,0.12), diff);
            float hoverBoost = 0.9 + 0.6 * u_motion; // uses your existing u_motion
            vec3 emission = mix(u_accent2, u_accent, n) * hoverBoost * (0.35 + 1.2*n + 0.8*rim) + spec * bias;

            vec3 col = base + emission;
            col = tonemap(col);

            // Subtle vignette via view angle
            float v = smoothstep(-0.1, 0.9, dot(N, V));
            col *= mix(0.85, 1.0, v);

            gl_FragColor = vec4(col, 1.0);
          }
        `;

        const mat = new THREE.ShaderMaterial({
          vertexShader: vsh,
          fragmentShader: fsh,
          uniforms, lights: false
        });

        sphere = new THREE.Mesh(geo, mat);
        scene.add(sphere);

        // Starfield
        const starGeo = new THREE.BufferGeometry();
        const starCount = 2000;
        const positions = new Float32Array(starCount * 3);
        for(let i=0;i<starCount;i++){
          const r = 24 * Math.pow(Math.random(), 0.5);
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2*Math.random()-1);
          positions[i*3+0] = r * Math.sin(phi) * Math.cos(theta);
          positions[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
          positions[i*3+2] = r * Math.cos(phi);
        }
        starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const starMat = new THREE.PointsMaterial({
          size: 0.025, color: 0xbfd6ff, transparent:true, opacity:0.8, depthWrite:false, blending:THREE.AdditiveBlending
        });
        stars = new THREE.Points(starGeo, starMat);
        scene.add(stars);

        // Interaction
        window.addEventListener('pointermove', (e)=>{
  const rectGL = glCanvas.getBoundingClientRect();
  targetMouse.set((e.clientX - rectGL.left)/rectGL.width, (e.clientY - rectGL.top)/rectGL.height);

  if (stageEl) {
    const rect = stageEl.getBoundingClientRect();
    titleTarget.set((e.clientX - rect.left)/rect.width, (e.clientY - rect.top)/rect.height);
  }
}, { passive:true });

if (stageEl) {
  stageEl.addEventListener('pointerenter', ()=> { hoverTarget = 1.0; }, { passive:true });
  stageEl.addEventListener('pointerleave', ()=> { hoverTarget = 0.0; }, { passive:true });
}

        window.addEventListener('deviceorientation', (e)=>{
          // lightweight tilt
          const gx = (e.gamma || 0) / 45;   // left-right
          const by = (e.beta  || 0) / 45;   // front-back
          tilt.set(gx, by);
        }, { passive:true });

        animate();
        return true;
      }catch(e){
        return false;
      }
    }
    

  const canvas = document.getElementById('renderSurface');
const myFluid = new Fluid(canvas);
myFluid.activate();


    function animate(){
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(animate);
      const t = (performance.now() - start) / 1000;

      // Ease mouse for buttery parallax
      mouse.lerp(targetMouse, 0.08);

        // Smooth hover and title follow
  hoverCurrent += (hoverTarget - hoverCurrent) * 0.08;
  titleCurrent.lerp(titleTarget, 0.10);

  // Map to 3D-ish rotations and subtle pop-out
  const rotX = (0.5 - titleCurrent.y) * 14; // degrees
  const rotY = (titleCurrent.x - 0.5) * 20; // degrees
  const tz   = 24 * hoverCurrent;           // px pop-out on hover
  const glow = 0.35 + 0.65 * hoverCurrent;  // stronger glow on hover
  const grad = (Math.sin(t * 0.35) * 0.5 + 0.5) * 100; // 0–100%

  // Push to CSS vars (GPU-friendly)
  root.style.setProperty('--title-rot-x', rotX.toFixed(3) + 'deg');
  root.style.setProperty('--title-rot-y', rotY.toFixed(3) + 'deg');
  root.style.setProperty('--title-translate-z', tz.toFixed(3) + 'px');
  root.style.setProperty('--title-glow', glow.toFixed(3));
  root.style.setProperty('--grad-pos', grad.toFixed(2));

  // Make shader slightly more active on hover (without breaking reduced motion)
  if (uniforms) {
    const baseMotion = (prefersReduced ? 0.0 : 1.0);
    uniforms.u_motion.value = baseMotion * (0.85 + 0.45 * hoverCurrent);
  }

      if(uniforms){
        uniforms.u_time.value = t;
        uniforms.u_mouse.value.copy(mouse);
      }

      if(sphere){
        // Slow idle rotation + parallax
        const parX = (mouse.y - 0.5 + tilt.y*0.15) * 0.5;
        const parY = (mouse.x - 0.5 + tilt.x*0.15) * 0.6;
        sphere.rotation.y += 0.002 * (prefersReduced ? 0 : 1);
        sphere.rotation.x = parX;
        sphere.rotation.y += parY * 0.02;
        sphere.position.z = Math.sin(t*0.6) * 0.15 * (prefersReduced ? 0 : 1);
      }

      if(stars){
        stars.rotation.y -= 0.0006;
        stars.rotation.x = (mouse.y - 0.5) * 0.08;
      }

      if(renderer && scene && camera){
        renderer.render(scene, camera);
      }
    }

    function resize(){
      const w = glCanvas.clientWidth || window.innerWidth;
      const h = glCanvas.clientHeight || window.innerHeight;
      const dpr = clampDPR();
      if(renderer){
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
      }
      glCanvas.width = Math.floor(w * dpr);
      glCanvas.height = Math.floor(h * dpr);
      if(camera){
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      if(uniforms){
        uniforms.u_res.value.set(glCanvas.width, glCanvas.height);
      }
    }
    const throttledResize = (()=>{ let tid=0; return ()=>{ clearTimeout(tid); tid=setTimeout(resize, 120); }; })();
    window.addEventListener('resize', throttledResize);

    // Canvas fallback if WebGL/Three fails
    function initFallback(){
      glCanvas.style.display = 'none';
      fbCanvas.style.display = 'block';
      const ctx = fbCanvas.getContext('2d');
      const size = ()=>{
        const w = fbCanvas.clientWidth || window.innerWidth;
        const h = fbCanvas.clientHeight || window.innerHeight;
        const d = clampDPR();
        fbCanvas.width = Math.floor(w*d);
        fbCanvas.height = Math.floor(h*d);
      };
      size(); window.addEventListener('resize', ()=>size(), { passive:true });

      let tt = 0;
      const loop = ()=>{
        tt += 0.008;
        const w = fbCanvas.width, h = fbCanvas.height;
        const g = ctx.createRadialGradient(w*0.5, h*0.55, h*0.05, w*0.5, h*0.5, h*0.6);
        g.addColorStop(0, `rgba(82,199,255,0.25)`);
        g.addColorStop(1, `rgba(7,10,17,1)`);
        ctx.fillStyle = g; ctx.fillRect(0,0,w,h);

        // simple sphere glyph
        const r = Math.min(w,h)*0.18;
        ctx.save();
        ctx.translate(w*0.5, h*0.5);
        ctx.rotate(Math.sin(tt*0.6)*0.05);
        const grd = ctx.createRadialGradient(-r*0.3, -r*0.3, r*0.1, 0, 0, r*1.1);
        grd.addColorStop(0, 'rgba(255,90,61,0.9)');
        grd.addColorStop(0.5, 'rgba(82,199,255,0.35)');
        grd.addColorStop(1, 'rgba(10,12,18,0.9)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
        ctx.restore();

        if(!prefersReduced) requestAnimationFrame(loop);
      };
      loop();
    }

    function ready(fn){ document.readyState !== 'loading' ? fn() : document.addEventListener('DOMContentLoaded', fn); }

    ready(()=>{
      const tryInit = ()=>{
        const ok = window.THREE ? initWebGL() : false;
        if(!ok) initFallback();
        resize();
      };
      if(window.THREE) tryInit();
      else {
        let tries=0;
        const iv=setInterval(()=>{ tries++; if(window.THREE){ clearInterval(iv); tryInit(); } else if(tries>50){ clearInterval(iv); initFallback(); resize(); } }, 50);
      }

      // Prevent default for nav placeholders
      document.querySelectorAll('.nav .btn').forEach(el=>{
        el.addEventListener('click', (e)=>{
          e.preventDefault();
          const route = e.currentTarget.getAttribute('data-route');
          // TODO: Hook router here later (route)
          // e.g., navigateTo(route)
          glowPulse(e.currentTarget);
        });
      });
    });

    // Micro-interaction pulse
    function glowPulse(el){
      el.style.boxShadow = '0 0 34px 0 rgba(255,90,61,0.35), 0 0 60px 0 rgba(82,199,255,0.25)';
      el.style.borderColor = 'rgba(255,90,61,0.8)';
      setTimeout(()=>{
        el.style.boxShadow = '';
        el.style.borderColor = '';
      }, 220);
    }
  })();
