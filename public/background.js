/* =====================================================================
   Cloudflare Single Email Viewer — 3D animated background
   Three.js (loaded from CDN via importmap). A full-screen fluid shader
   plane + a glowing particle field, reacting to the pointer. Exposes a
   small control API on window.__bg used by app.js for the camera
   zoom-in transition. Falls back gracefully to a CSS gradient if WebGL
   or the CDN module is unavailable.
   ===================================================================== */

// Default no-op API so app.js never breaks even if 3D fails to load.
window.__bg = {
  zoomIn: function () {},
  reset: function () {},
  setAccent: function () {},
};

function enableFallback() {
  var fb = document.getElementById('bg-fallback');
  var canvas = document.getElementById('bg-canvas');
  if (fb) fb.style.display = 'block';
  if (canvas) canvas.style.display = 'none';
}

(async function initBackground() {
  // Respect reduced-motion: skip heavy 3D, use the calm CSS gradient.
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    enableFallback();
    return;
  }

  var THREE;
  try {
    THREE = await import('three');
  } catch (err) {
    // CDN blocked / offline -> graceful fallback.
    enableFallback();
    return;
  }

  var canvas = document.getElementById('bg-canvas');
  if (!canvas) {
    enableFallback();
    return;
  }

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch (e) {
    enableFallback();
    return;
  }

  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(DPR);
  renderer.setSize(window.innerWidth, window.innerHeight);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 0, 5);

  var accent = new THREE.Color(0x8b5cf6);

  /* ---------- Fluid shader plane ---------- */
  var uniforms = {
    uTime: { value: 0 },
    uRes: {
      value: new THREE.Vector2(window.innerWidth, window.innerHeight),
    },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uAccent: { value: new THREE.Vector3(accent.r, accent.g, accent.b) },
  };

  var vertexShader = [
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = uv;',
    '  gl_Position = vec4(position, 1.0);',
    '}',
  ].join('\n');

  var fragmentShader = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform float uTime;',
    'uniform vec2 uRes;',
    'uniform vec2 uMouse;',
    'uniform vec3 uAccent;',
    '',
    'mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }',
    'float noise(vec2 p){',
    '  vec2 i=floor(p); vec2 f=fract(p);',
    '  vec2 u=f*f*(3.0-2.0*f);',
    '  return mix(mix(hash(i+vec2(0,0)),hash(i+vec2(1,0)),u.x),',
    '             mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v=0.0; float a=0.5;',
    '  for(int i=0;i<5;i++){ v+=a*noise(p); p=rot(0.6)*p*1.9; a*=0.55; }',
    '  return v;',
    '}',
    'void main(){',
    '  vec2 uv=(gl_FragCoord.xy-0.5*uRes)/min(uRes.x,uRes.y);',
    '  vec2 m=(uMouse-0.5)*0.6;',
    '  float t=uTime*0.06;',
    '  vec2 q=vec2(fbm(uv*1.6+t+m), fbm(uv*1.6-t+vec2(2.0)));',
    '  float n=fbm(uv*2.2 + q*1.8 + t*1.5);',
    '  float glow=smoothstep(0.15,0.95,n);',
    '  vec3 deep=vec3(0.035,0.02,0.07);',
    '  vec3 col=mix(deep, uAccent, glow*0.85);',
    '  col+=uAccent*pow(glow,3.0)*0.5;',
    '  float d=length(uv);',
    '  col*=1.0-0.55*smoothstep(0.4,1.3,d);',
    '  col+=0.04*hash(uv+t);',
    '  gl_FragColor=vec4(col,1.0);',
    '}',
  ].join('\n');

  var planeMat = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    depthWrite: false,
  });
  var planeGeo = new THREE.PlaneGeometry(2, 2);
  var plane = new THREE.Mesh(planeGeo, planeMat);
  plane.frustumCulled = false;
  scene.add(plane);

  /* ---------- Particle field ---------- */
  var COUNT = 900;
  var positions = new Float32Array(COUNT * 3);
  for (var i = 0; i < COUNT; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * 14;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 9;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1;
  }
  var pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  var pMat = new THREE.PointsMaterial({
    color: accent.clone(),
    size: 0.03,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  var points = new THREE.Points(pGeo, pMat);
  scene.add(points);

  /* ---------- Interaction & state ---------- */
  var targetMouse = { x: 0.5, y: 0.5 };
  var smoothMouse = { x: 0.5, y: 0.5 };
  var targetZ = 5;
  var parallax = { x: 0, y: 0 };

  function onPointer(clientX, clientY) {
    targetMouse.x = clientX / window.innerWidth;
    targetMouse.y = 1 - clientY / window.innerHeight;
  }
  window.addEventListener('pointermove', function (e) {
    onPointer(e.clientX, e.clientY);
  });
  window.addEventListener(
    'touchmove',
    function (e) {
      if (e.touches && e.touches[0]) {
        onPointer(e.touches[0].clientX, e.touches[0].clientY);
      }
    },
    { passive: true }
  );

  function onResize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    uniforms.uRes.value.set(w * DPR, h * DPR);
  }
  window.addEventListener('resize', onResize);
  onResize();

  /* ---------- Public control API ---------- */
  window.__bg = {
    zoomIn: function () {
      targetZ = 2.4;
    },
    reset: function () {
      targetZ = 5;
    },
    setAccent: function (r, g, b) {
      accent.setRGB(r, g, b);
      uniforms.uAccent.value.set(accent.r, accent.g, accent.b);
      pMat.color.setRGB(r, g, b);
    },
  };

  /* ---------- Render loop ---------- */
  var clock = new THREE.Clock();
  var running = true;
  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    if (running) {
      clock.start();
      loop();
    }
  });

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    var t = clock.getElapsedTime();
    uniforms.uTime.value = t;

    smoothMouse.x += (targetMouse.x - smoothMouse.x) * 0.05;
    smoothMouse.y += (targetMouse.y - smoothMouse.y) * 0.05;
    uniforms.uMouse.value.set(smoothMouse.x, smoothMouse.y);

    parallax.x += ((smoothMouse.x - 0.5) * 0.8 - parallax.x) * 0.05;
    parallax.y += ((smoothMouse.y - 0.5) * 0.5 - parallax.y) * 0.05;

    camera.position.x = parallax.x;
    camera.position.y = parallax.y;
    camera.position.z += (targetZ - camera.position.z) * 0.06;
    camera.lookAt(0, 0, 0);

    points.rotation.y = t * 0.02;
    points.rotation.x = Math.sin(t * 0.1) * 0.05;

    renderer.render(scene, camera);
  }
  loop();
})();
