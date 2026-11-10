/* =========================================================================
   THE QUIDDITCH CUP
   A fixed-camera isometric diorama. Everything is generated procedurally.
   Three.js r160 (classic global build) — no external models or textures.
   ========================================================================= */
(function () {
  'use strict';

  const embedded = document.documentElement.classList.contains('diorama-embed');
  let renderReady = false;
  let renderFailed = false;
  const THREE = window.THREE;
  const canvas = document.getElementById('stage');
  const statusText = document.getElementById('status-text');
  const motionButton = document.getElementById('motion');
  const fallback = document.getElementById('fallback');
  const weatherButtons = Array.from(document.querySelectorAll('[data-weather]'));
  const weatherVeil = document.getElementById('weather-veil');
  const lightningFlashEl = document.getElementById('lightning-flash');
  const snitchTag = document.getElementById('snitch-tag');
  const highlightButton = document.getElementById('highlight');
  const soundButton = document.getElementById('sound');
  const playerTip = document.getElementById('player-tip');
  const playerTipName = playerTip && playerTip.querySelector('.tip-name');
  const playerTipRole = playerTip && playerTip.querySelector('.tip-role');
  const scoreGEl = document.getElementById('score-g');
  const scoreSEl = document.getElementById('score-s');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function showFallback(error) {
    console.error(error);
    if (fallback) fallback.hidden = false;
    if (canvas) canvas.style.visibility = 'hidden';
    document.querySelector('.hud')?.setAttribute('hidden', '');
    if (embedded) window.parent.postMessage({ type: 'quidditch-error' }, window.location.origin);
  }

  if (!THREE) {
    showFallback('Three.js failed to load.');
    return;
  }

  /* -----------------------------------------------------------------------
     Renderer + scene + camera
     ----------------------------------------------------------------------- */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: embedded,
      stencil: false,
      powerPreference: embedded ? 'low-power' : 'high-performance'
    });
  } catch (error) {
    showFallback(error);
    return;
  }
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.14;
  renderer.shadowMap.enabled = !embedded;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = embedded ? null : new THREE.Color(0xfbfaf6);

  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 140);
  const ISO_DIR = new THREE.Vector3(1, 1, 1).normalize();
  camera.position.copy(ISO_DIR).multiplyScalar(64);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const world = new THREE.Group();
  scene.add(world);

  /* -----------------------------------------------------------------------
     Small utilities
     ----------------------------------------------------------------------- */
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(0x51D17C0);
  const rr = (a, b) => a + (b - a) * rand();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const wrapAngle = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };

  const MAT_CACHE = new Map();
  function material(color, opts) {
    const o = Object.assign({
      roughness: 0.92,
      metalness: 0.0,
      flatShading: true
    }, opts || {});
    const key = [color, o.roughness, o.metalness, o.flatShading, o.side || 0,
      o.emissive || 0, o.emissiveIntensity || 0, o.transparent || false,
      o.opacity === undefined ? 1 : o.opacity, o.depthWrite === undefined ? true : o.depthWrite,
      o.alphaTest || 0].join('|');
    if (!o.map && !o.vertexColors && MAT_CACHE.has(key)) return MAT_CACHE.get(key);
    const m = new THREE.MeshStandardMaterial(Object.assign({ color }, o));
    if (!o.map && !o.vertexColors) MAT_CACHE.set(key, m);
    return m;
  }

  function addMesh(parent, geometry, mat, x, y, z, castShadow, receiveShadow) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.castShadow = castShadow !== false;
    mesh.receiveShadow = receiveShadow !== false;
    parent.add(mesh);
    return mesh;
  }

  function addBox(parent, w, h, d, mat, x, y, z, castShadow, receiveShadow) {
    return addMesh(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z,
      castShadow, receiveShadow);
  }

  function addCylinder(parent, rt, rb, h, seg, mat, x, y, z, castShadow, receiveShadow) {
    return addMesh(parent, new THREE.CylinderGeometry(rt, rb, h, seg, 1), mat,
      x, y, z, castShadow, receiveShadow);
  }

  function addCone(parent, r, h, seg, mat, x, y, z, castShadow, receiveShadow) {
    return addMesh(parent, new THREE.ConeGeometry(r, h, seg, 1), mat, x, y, z,
      castShadow, receiveShadow);
  }

  function cylinderBetween(parent, ax, ay, az, bx, by, bz, radius, mat, radialSegments) {
    const a = new THREE.Vector3(ax, ay, az);
    const b = new THREE.Vector3(bx, by, bz);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(radius * 0.82, radius, len, radialSegments || 5, 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function roundedRectShape(w, d, r) {
    const s = new THREE.Shape();
    const x = -w / 2;
    const y = -d / 2;
    const radius = Math.min(r, Math.min(w, d) * 0.45);
    s.moveTo(x + radius, y);
    s.lineTo(x + w - radius, y);
    s.quadraticCurveTo(x + w, y, x + w, y + radius);
    s.lineTo(x + w, y + d - radius);
    s.quadraticCurveTo(x + w, y + d, x + w - radius, y + d);
    s.lineTo(x + radius, y + d);
    s.quadraticCurveTo(x, y + d, x, y + d - radius);
    s.lineTo(x, y + radius);
    s.quadraticCurveTo(x, y, x + radius, y);
    return s;
  }

  function roundedSlab(w, d, h, r, mat, y, castShadow, receiveShadow) {
    const shape = roundedRectShape(w, d, r);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: h,
      steps: 1,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.07,
      bevelThickness: 0.06,
      curveSegments: 5
    });
    geo.rotateX(-Math.PI / 2);
    const mesh = addMesh(world, geo, mat, 0, y, 0, castShadow, receiveShadow);
    return mesh;
  }

  function roundedCap(w, d, r, mat, y) {
    const shape = roundedRectShape(w, d, r);
    const geo = new THREE.ShapeGeometry(shape, 8);
    geo.rotateX(-Math.PI / 2);
    const mesh = addMesh(world, geo, mat, 0, y, 0, false, true);
    return mesh;
  }

  /* -----------------------------------------------------------------------
     Palette + materials
     ----------------------------------------------------------------------- */
  const COL = {
    paper: 0xfbfaf6,
    cream: 0xeee4cf,
    creamLight: 0xf5eddc,
    stone: 0xc8b99d,
    stoneShade: 0xa99473,
    stoneDark: 0x7f6d54,
    earth: 0x967f5b,
    earthDark: 0x725d42,
    wood: 0x6d4a2d,
    woodLight: 0x956a3f,
    woodDark: 0x4b3120,
    seat: 0x8b623b,
    gold: 0xc79a3f,
    goldLight: 0xe7c477,
    goldDark: 0x8e6721,
    grass: 0x5f944e,
    leaf: 0x527d42,
    ink: 0x27231d,
    glass: 0xffc86b,
    cloud: 0xf4efe3
  };

  const M = {
    cream: material(COL.cream),
    creamLight: material(COL.creamLight),
    stone: material(COL.stone),
    stoneShade: material(COL.stoneShade),
    stoneDark: material(COL.stoneDark),
    earth: material(COL.earth),
    earthDark: material(COL.earthDark),
    wood: material(COL.wood),
    woodLight: material(COL.woodLight),
    woodDark: material(COL.woodDark),
    seat: material(COL.seat),
    gold: material(0xd2a13a, {
      metalness: 0.32, roughness: 0.37, emissive: 0x4b2f04, emissiveIntensity: 0.32
    }),
    goldBright: material(0xf0c86d, {
      metalness: 0.22, roughness: 0.28, emissive: 0x72500d, emissiveIntensity: 0.38
    }),
    goldDark: material(COL.goldDark, { metalness: 0.25, roughness: 0.55 }),
    ink: material(COL.ink, { roughness: 1 }),
    leaf: material(COL.leaf),
    glass: new THREE.MeshBasicMaterial({ color: COL.glass }),
    windowGlow: new THREE.MeshBasicMaterial({ color: 0xffc36b }),
    darkGlass: new THREE.MeshStandardMaterial({
      color: 0x334b51, roughness: 0.25, metalness: 0.1,
      emissive: 0x162326, emissiveIntensity: 0.3
    })
  };

  // Snow is a separate toggleable layer: white caps, roof blankets and banks.
  const snowMat = material(0xf5fbfd, {
    roughness: 0.92, metalness: 0, emissive: 0x1b2c34, emissiveIntensity: 0.035
  });
  const snowOverlays = [];
  function addSnowBox(parent, w, h, d, x, y, z) {
    const mesh = addBox(parent, w, h, d, snowMat, x, y, z, true, true);
    mesh.visible = false;
    snowOverlays.push(mesh);
    return mesh;
  }
  function addSnowRoof(parent, roof, scale) {
    const mesh = new THREE.Mesh(roof.geometry, snowMat);
    mesh.position.copy(roof.position);
    mesh.position.y += .012;
    mesh.rotation.copy(roof.rotation);
    mesh.scale.copy(roof.scale).multiplyScalar(scale || 1.015);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    parent.add(mesh);
    snowOverlays.push(mesh);
    return mesh;
  }

  const HOUSES = [
    {
      key: 'gryffindor', name: 'Gryffindor',
      main: 0x8b2634, deep: 0x651a25, light: 0xd6ae58,
      roof: 0x7d2b33, skin: 0xe6bd9a
    },
    {
      key: 'slytherin', name: 'Slytherin',
      main: 0x245b47, deep: 0x163e30, light: 0xb6c5b2,
      roof: 0x2c5142, skin: 0xdfb391
    },
    {
      key: 'ravenclaw', name: 'Ravenclaw',
      main: 0x2d4674, deep: 0x1f3155, light: 0xb89355,
      roof: 0x324b68, skin: 0xc99570
    },
    {
      key: 'hufflepuff', name: 'Hufflepuff',
      main: 0xc69a28, deep: 0x8d6a14, light: 0x2e2a22,
      roof: 0x9b7520, skin: 0xf0ceb0
    }
  ];
  const HOUSE = Object.fromEntries(HOUSES.map(h => [h.key, h]));

  /* -----------------------------------------------------------------------
     Lighting
     ----------------------------------------------------------------------- */
  const hemi = new THREE.HemisphereLight(0xf9fbff, 0xa89273, 1.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0cf, 3.15);
  sun.position.set(18, 30, 20);
  sun.target.position.set(-2, 0, -3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -27;
  sun.shadow.camera.right = 27;
  sun.shadow.camera.top = 27;
  sun.shadow.camera.bottom = -27;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 85;
  sun.shadow.bias = -0.00055;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2.1;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0xd7e8ff, 0.55);
  fill.position.set(-20, 14, -18);
  scene.add(fill);

  const warmBounce = new THREE.DirectionalLight(0xffd6a0, 0.24);
  warmBounce.position.set(6, 5, 22);
  scene.add(warmBounce);

  /* -----------------------------------------------------------------------
     Ground shadow, diorama base
     ----------------------------------------------------------------------- */
  function makeShadowBlobTexture() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 80, 6, 128, 80, 118);
    g.addColorStop(0, 'rgba(87, 74, 55, 0.31)');
    g.addColorStop(0.44, 'rgba(87, 74, 55, 0.18)');
    g.addColorStop(0.78, 'rgba(87, 74, 55, 0.05)');
    g.addColorStop(1, 'rgba(87, 74, 55, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const softShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(51, 35),
    new THREE.MeshBasicMaterial({
      map: makeShadowBlobTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 1
    })
  );
  softShadow.rotation.x = -Math.PI / 2;
  softShadow.position.set(2.3, -2.56, 2.1);
  softShadow.renderOrder = 1;
  world.add(softShadow);

  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.ShadowMaterial({ color: 0x5b4b37, opacity: 0.14, transparent: true, depthWrite: false })
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = -2.64;
  shadowCatcher.receiveShadow = true;
  world.add(shadowCatcher);

  // The base is a thick, softly rounded slab: warm parchment on top and strata below.
  roundedSlab(37.4, 25.4, 0.42, 1.0, M.cream, -0.42, true, true);
  roundedSlab(37.65, 25.65, 0.075, 1.0, M.goldDark, -0.505, false, true);
  roundedSlab(36.7, 24.7, 1.18, 0.95, M.earth, -1.68, true, true);
  roundedSlab(35.3, 23.3, 0.42, 0.9, M.earthDark, -2.10, true, true);
  const baseCap = roundedCap(37.35, 25.35, 1.0, M.creamLight, 0.012);
  baseCap.receiveShadow = true;

  // A thin decorative inset line on the top surface, just beyond the stands.
  const rimShape = roundedRectShape(35.55, 23.55, 0.85);
  const rimGeo = new THREE.ShapeGeometry(rimShape, 8);
  rimGeo.rotateX(-Math.PI / 2);
  const rim = addMesh(world, rimGeo, material(0xd9ceb7, { roughness: 1 }), 0, 0.022, 0, false, true);

  /* -----------------------------------------------------------------------
     Pitch texture and surface
     ----------------------------------------------------------------------- */
  function makePitchTexture(mode) {
    const winter = mode === 'winter';
    const storm = mode === 'storm';
    const W = 896;
    const H = 512;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);

    const inset = 10;
    const radius = 48;

    function roundedPath(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    ctx.save();
    roundedPath(inset, inset, W - inset * 2, H - inset * 2, radius);
    ctx.clip();

    ctx.fillStyle = winter ? '#e9f1f3' : (storm ? '#3d5949' : '#5c9150');
    ctx.fillRect(0, 0, W, H);

    // Mown stripes, translated into a snow-crust or rain-soaked surface.
    for (let i = 0; i < 14; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = winter ? 'rgba(255, 255, 255, 0.18)'
          : (storm ? 'rgba(147, 185, 164, 0.07)' : 'rgba(224, 233, 164, 0.105)');
        ctx.fillRect(inset + i * (W / 14), inset, W / 14, H - inset * 2);
      } else {
        ctx.fillStyle = winter ? 'rgba(177, 201, 211, 0.09)'
          : (storm ? 'rgba(4, 18, 12, 0.14)' : 'rgba(26, 47, 24, 0.075)');
        ctx.fillRect(inset + i * (W / 14), inset, W / 14, H - inset * 2);
      }
    }

    // House-tinted ends, kept extremely quiet.
    const gl = ctx.createLinearGradient(0, 0, 220, 0);
    gl.addColorStop(0, winter ? 'rgba(132, 163, 176, .055)' : (storm ? 'rgba(42, 12, 17, .12)' : 'rgba(112, 22, 34, .16)'));
    gl.addColorStop(1, 'rgba(112, 22, 34, 0)');
    ctx.fillStyle = gl;
    ctx.fillRect(inset, inset, 220, H - inset * 2);
    const sl = ctx.createLinearGradient(W, 0, W - 220, 0);
    sl.addColorStop(0, winter ? 'rgba(91, 132, 146, .055)' : (storm ? 'rgba(5, 34, 23, .14)' : 'rgba(16, 73, 49, .15)'));
    sl.addColorStop(1, 'rgba(16, 73, 49, 0)');
    ctx.fillStyle = sl;
    ctx.fillRect(W - 220 - inset, inset, 220, H - inset * 2);

    // Weather-specific broad surface treatments.
    if (storm) {
      // Wet shine and standing rainwater.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 9; i++) {
        const x = rr(inset + 50, W - inset - 50);
        const y = rr(inset + 50, H - inset - 50);
        const angle = rr(-1.2, 1.2);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        const shine = ctx.createLinearGradient(0, -20, 0, 20);
        shine.addColorStop(0, 'rgba(189, 217, 218, 0)');
        shine.addColorStop(.5, 'rgba(189, 217, 218, .12)');
        shine.addColorStop(1, 'rgba(189, 217, 218, 0)');
        ctx.fillStyle = shine;
        ctx.fillRect(-rr(40, 130), -rr(3, 10), rr(80, 260), rr(6, 20));
        ctx.restore();
      }
      ctx.restore();
      for (let i = 0; i < 23; i++) {
        const x = rr(inset + 60, W - inset - 60);
        const y = rr(inset + 55, H - inset - 55);
        const rx = rr(10, 42);
        const ry = rr(4, 16);
        const puddle = ctx.createRadialGradient(x, y, 0, x, y, rx);
        puddle.addColorStop(0, 'rgba(160, 194, 202, .28)');
        puddle.addColorStop(.55, 'rgba(89, 126, 129, .18)');
        puddle.addColorStop(1, 'rgba(56, 83, 72, 0)');
        ctx.fillStyle = puddle;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, rr(-.5, .5), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(198, 224, 226, .16)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    if (winter) {
      // Wind-packed snow, icy patches and dark blades peeking through.
      for (let i = 0; i < 30; i++) {
        const x = rr(inset + 35, W - inset - 35);
        const y = rr(inset + 35, H - inset - 35);
        const rx = rr(24, 120);
        const ry = rr(8, 34);
        const drift = ctx.createRadialGradient(x, y, 0, x, y, rx);
        drift.addColorStop(0, `rgba(255, 255, 255, ${rr(.15, .36)})`);
        drift.addColorStop(.6, `rgba(235, 245, 247, ${rr(.07, .18)})`);
        drift.addColorStop(1, 'rgba(228, 240, 244, 0)');
        ctx.fillStyle = drift;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, rr(-.45, .45), 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 13; i++) {
        const x = rr(inset + 80, W - inset - 80);
        const y = rr(inset + 70, H - inset - 70);
        const rx = rr(16, 52);
        const ry = rr(5, 16);
        const ice = ctx.createLinearGradient(x - rx, y, x + rx, y);
        ice.addColorStop(0, 'rgba(148, 190, 204, 0)');
        ice.addColorStop(.5, 'rgba(164, 207, 219, .19)');
        ice.addColorStop(1, 'rgba(148, 190, 204, 0)');
        ctx.fillStyle = ice;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, rr(-.4, .4), 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 420; i++) {
        const x = rr(inset, W - inset);
        const y = rr(inset, H - inset);
        ctx.fillStyle = rand() > .55 ? 'rgba(103, 128, 130, .11)' : 'rgba(255,255,255,.25)';
        ctx.fillRect(x, y, 1, rand() > .8 ? 2 : 1);
      }
    }

    // Micro-texture: grass grain, snow crystals, or rain-darkened stubble.
    for (let i = 0; i < 8200; i++) {
      const x = rr(inset, W - inset);
      const y = rr(inset, H - inset);
      const light = rand() > 0.54;
      if (winter) {
        ctx.fillStyle = light
          ? `rgba(255, 255, 255, ${rr(.10, .34)})`
          : `rgba(131, 160, 169, ${rr(.025, .09)})`;
      } else if (storm) {
        ctx.fillStyle = light
          ? `rgba(166, 198, 181, ${rr(.025, .10)})`
          : `rgba(2, 16, 9, ${rr(.06, .20)})`;
      } else {
        ctx.fillStyle = light
          ? `rgba(196, 217, 132, ${rr(.05, .19)})`
          : `rgba(22, 55, 26, ${rr(.04, .15)})`;
      }
      const s = rand() > 0.86 ? 2 : 1;
      ctx.fillRect(x, y, s, s);
    }

    // Soft wear / weather wash along the centre.
    const wear = ctx.createRadialGradient(W / 2, H / 2, 23, W / 2, H / 2, 265);
    wear.addColorStop(0, winter ? 'rgba(148, 181, 193, .08)'
      : (storm ? 'rgba(173, 205, 203, .07)' : 'rgba(215, 204, 151, .075)'));
    wear.addColorStop(1, 'rgba(215, 204, 151, 0)');
    ctx.fillStyle = wear;
    ctx.fillRect(inset, inset, W - inset * 2, H - inset * 2);

    // Pitch lines. Snow gets a colder blue-grey ink; rain gets bright silver.
    const lineMain = winter ? 'rgba(94, 123, 137, .8)'
      : (storm ? 'rgba(219, 235, 237, .78)' : 'rgba(244, 238, 215, .92)');
    const lineSoft = winter ? 'rgba(94, 123, 137, .68)'
      : (storm ? 'rgba(219, 235, 237, .68)' : 'rgba(244, 238, 215, .82)');

    ctx.strokeStyle = lineMain;
    ctx.lineWidth = 4;
    roundedPath(inset + 29, inset + 29, W - (inset + 29) * 2, H - (inset + 29) * 2, 28);
    ctx.stroke();

    ctx.strokeStyle = lineSoft;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 91, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 11, 0, Math.PI * 2);
    ctx.fillStyle = lineMain;
    ctx.fill();

    // Goal areas at each end.
    const goalLineX = inset + 29 + 92;
    ctx.beginPath();
    ctx.moveTo(goalLineX, H * 0.30);
    ctx.lineTo(goalLineX, H * 0.70);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(inset + 29, H / 2, 180, -Math.PI / 2.7, Math.PI / 2.7);
    ctx.stroke();
    const goalLineXR = W - inset - 29 - 92;
    ctx.beginPath();
    ctx.moveTo(goalLineXR, H * 0.30);
    ctx.lineTo(goalLineXR, H * 0.70);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W - inset - 29, H / 2, 180, Math.PI - Math.PI / 2.7, Math.PI + Math.PI / 2.7);
    ctx.stroke();

    // Centre roundel with the Hogwarts H.
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 36, 0, Math.PI * 2);
    ctx.fillStyle = winter ? 'rgba(166, 136, 73, .76)'
      : (storm ? 'rgba(167, 139, 72, .7)' : 'rgba(196, 158, 72, .82)');
    ctx.fill();
    ctx.strokeStyle = winter ? 'rgba(113, 139, 152, .85)'
      : (storm ? 'rgba(225, 237, 234, .8)' : 'rgba(250, 239, 206, .9)');
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = winter ? 'rgba(77, 99, 111, .95)'
      : (storm ? 'rgba(238, 243, 238, .94)' : 'rgba(252, 245, 221, .96)');
    ctx.font = 'bold 38px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', W / 2, H / 2 + 2);

    // Corner marks and tiny accents.
    ctx.fillStyle = winter ? 'rgba(119, 147, 160, .65)'
      : (storm ? 'rgba(210, 230, 231, .6)' : 'rgba(217, 180, 92, .7)');
    for (const [x, y] of [[inset + 52, inset + 52], [W - inset - 52, inset + 52],
      [inset + 52, H - inset - 52], [W - inset - 52, H - inset - 52]]) {
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Restrained lip around the field.
    ctx.strokeStyle = winter ? 'rgba(115, 145, 158, .34)'
      : (storm ? 'rgba(4, 18, 12, .55)' : 'rgba(56, 68, 36, .25)');
    ctx.lineWidth = 6;
    roundedPath(inset, inset, W - inset * 2, H - inset * 2, radius);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = 1;
    return texture;
  }

  const pitchMaterials = {};
  for (const mode of ['clear', 'storm', 'winter']) {
    pitchMaterials[mode] = new THREE.MeshStandardMaterial({
      map: makePitchTexture(mode),
      transparent: true,
      alphaTest: 0.46,
      roughness: mode === 'storm' ? 0.32 : (mode === 'winter' ? 0.9 : 0.98),
      metalness: mode === 'storm' ? 0.14 : 0,
      side: THREE.DoubleSide
    });
  }
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(28.8, 16.45), pitchMaterials.clear);
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.y = 0.064;
  pitch.receiveShadow = true;
  world.add(pitch);

  // A very subtle rolled rim underneath the field.
  const fieldRimMat = new THREE.MeshBasicMaterial({
    color: 0xb3a27f, transparent: true, opacity: 0.36, depthWrite: false
  });
  const fieldRim = new THREE.Mesh(new THREE.PlaneGeometry(29.3, 16.95), fieldRimMat);
  fieldRim.rotation.x = -Math.PI / 2;
  fieldRim.position.y = 0.043;
  world.add(fieldRim);

  // A few tiny 3D tufts near the very edge give the grass a tactile silhouette.
  let tuftMesh;
  (function addTufts() {
    const geo = new THREE.ConeGeometry(0.055, 0.23, 3, 1);
    const tuftMat = material(0x6f9d55, { roughness: 1 });
    const inst = new THREE.InstancedMesh(geo, tuftMat, 84);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 84; i++) {
      const side = rand() > 0.5 ? 1 : -1;
      const alongX = rand() > 0.5;
      let x, z;
      if (alongX) {
        x = rr(-14.2, 14.2);
        z = side * rr(8.12, 8.31);
      } else {
        z = rr(-8.1, 8.1);
        x = side * rr(14.18, 14.34);
      }
      dummy.position.set(x, 0.14 + rr(0, .05), z);
      dummy.rotation.set(rr(-.12, .12), rr(0, 6.28), rr(-.12, .12));
      dummy.scale.setScalar(rr(.7, 1.3));
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.receiveShadow = true;
    tuftMesh = inst;
    world.add(inst);
  })();

  /* -----------------------------------------------------------------------
     Spectators + grandstands
     ----------------------------------------------------------------------- */
  const crowd = [];
  const housesForSides = [
    ['gryffindor', 'ravenclaw', 'slytherin', 'hufflepuff'],
    ['slytherin', 'hufflepuff', 'gryffindor', 'ravenclaw']
  ];

  function buildStand(sign) {
    const g = new THREE.Group();
    const length = 24.0;
    const rowCount = 4;
    const rowDepth = 0.68;
    const rowRise = 0.34;

    for (let row = 0; row < rowCount; row++) {
      const z = sign * (8.93 + row * rowDepth);
      const y = 0.18 + row * rowRise;
      addBox(g, length, 0.34, rowDepth + .08, M.woodDark, 0, y, z, true, true);
      addBox(g, length, 0.065, rowDepth - .02, M.seat, 0, y + .205, z, false, true);

      // Wooden riser face.
      addBox(g, length, rowRise + .035, 0.075, M.wood, 0, y + .17, z - sign * (rowDepth / 2 + .02), true, true);

      // A snow-laden lip on each row; visible in winter only.
      addSnowBox(g, length - .2, .035, .16, 0, y + .252, z - sign * .19);
    }

    // Retaining wall at the pitch side, with a slim brass rail.
    addBox(g, length + .2, 0.34, .13, M.wood, 0, .13, sign * 8.53, true, true);
    addBox(g, length + .2, .035, .035, M.gold, 0, .38, sign * 8.53, false, false);
    addSnowBox(g, length + .14, .035, .105, 0, .405, sign * 8.53);
    for (let x = -11.4; x <= 11.4; x += 2.28) {
      addBox(g, .055, .38, .055, M.goldDark, x, .20, sign * 8.55, false, false);
    }

    // Tall back panel.
    addBox(g, length + .55, 1.66, .26, M.woodDark, 0, .83, sign * 11.42, true, true);
    addBox(g, length + .72, .13, .36, M.wood, 0, 1.70, sign * 11.42, true, true);
    addSnowBox(g, length + .66, .055, .43, 0, 1.78, sign * 11.42);

    // House-colour cloth panels turn the near stand's outer face into a wall
    // of scarlet, blue, green and gold rather than a long brown board.
    const panelSections = [[-11.75, -6.1], [-5.8, -0.35], [0.35, 5.8], [6.1, 11.75]];
    const panelOrder = housesForSides[sign > 0 ? 0 : 1];
    for (let i = 0; i < 4; i++) {
      const house = HOUSE[panelOrder[i]];
      const a = panelSections[i][0];
      const b = panelSections[i][1];
      const w = b - a - .16;
      const cloth = new THREE.MeshStandardMaterial({
        map: makeHousePanelTexture(house), roughness: 1, metalness: 0
      });
      addBox(g, w, .96, .035, cloth, (a + b) / 2, .78, sign * (11.42 + .128), false, true);
    }

    // Decorative vertical posts.
    for (const x of [-12.05, -8.0, -4.0, 0, 4.0, 8.0, 12.05]) {
      addBox(g, .12, 1.86, .12, M.wood, x, .93, sign * 11.56, false, true);
      addBox(g, .19, .06, .19, M.gold, x, 1.88, sign * 11.56, false, false);
    }

    // Aisles drawn over the shallow bleachers.
    for (const x of [-5.7, 0.2, 6.0]) {
      for (let row = 0; row < rowCount; row++) {
        const z = sign * (8.93 + row * rowDepth);
        addBox(g, .21, .032, rowDepth, M.wood, x, .20 + row * rowRise + .19, z, false, false);
      }
    }

    world.add(g);

    // Spectators, arranged in four house-coloured blocks.
    const sections = [[-11.65, -6.15], [-5.85, -0.35], [0.35, 5.85], [6.15, 11.65]];
    const houseOrder = housesForSides[sign > 0 ? 0 : 1];
    for (let row = 0; row < rowCount; row++) {
      for (let s = 0; s < sections.length; s++) {
        const [a, b] = sections[s];
        const house = HOUSE[houseOrder[s]];
        const count = Math.floor((b - a) / 0.5);
        for (let i = 0; i < count; i++) {
          if (rand() > .91) continue;
          const x = lerp(a, b, (i + .5) / count) + rr(-.07, .07);
          const z = sign * (9.03 + row * rowDepth) + rr(-.06, .06);
          const y = 0.39 + row * rowRise + rr(0, .025);
          const bodyCol = new THREE.Color(house.main);
          bodyCol.offsetHSL(rr(-.018, .018), rr(-.06, .05), rr(-.035, .055));
          const headCol = new THREE.Color(house.skin).offsetHSL(0, rr(-.05, .03), rr(-.05, .045));
          crowd.push({
            x, y, z, phase: rr(0, 6.28), speed: rr(.7, 1.25),
            amp: rr(.009, .024), house,
            bodyCol, headCol,
            hat: rand() > .78,
            hatCol: new THREE.Color(rand() > .5 ? house.deep : house.light)
          });
        }
      }
    }
  }

  buildStand(-1);
  buildStand(1);

  let crowdBodies, crowdHeads, crowdHats, crowdSnow;
  (function buildCrowdMeshes() {
    const bodyGeo = new THREE.BoxGeometry(.19, .32, .15);
    const headGeo = new THREE.SphereGeometry(.10, 6, 4);
    const hatGeo = new THREE.ConeGeometry(.072, .16, 5, 1);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, flatShading: true, vertexColors: false
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: .95, flatShading: true, vertexColors: false
    });
    const hatMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, flatShading: true, vertexColors: false
    });
    crowdBodies = new THREE.InstancedMesh(bodyGeo, bodyMat, crowd.length);
    crowdHeads = new THREE.InstancedMesh(headGeo, headMat, crowd.length);
    const hats = crowd.filter(s => s.hat);
    crowdHats = new THREE.InstancedMesh(hatGeo, hatMat, hats.length);
    for (let i = 0; i < crowd.length; i++) {
      crowdBodies.setColorAt(i, crowd[i].bodyCol);
      crowdHeads.setColorAt(i, crowd[i].headCol);
    }
    for (let i = 0; i < hats.length; i++) crowdHats.setColorAt(i, hats[i].hatCol);
    crowdBodies.instanceColor.needsUpdate = true;
    crowdHeads.instanceColor.needsUpdate = true;
    if (crowdHats.instanceColor) crowdHats.instanceColor.needsUpdate = true;
    crowdBodies.castShadow = false;
    crowdBodies.receiveShadow = true;
    crowdHeads.castShadow = false;
    crowdHats.castShadow = false;

    const snowGeo = new THREE.SphereGeometry(.065, 5, 3);
    crowdSnow = new THREE.InstancedMesh(snowGeo, snowMat, crowd.length);
    crowdSnow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    crowdSnow.castShadow = false;
    crowdSnow.receiveShadow = false;
    crowdSnow.visible = false;
    for (let i = 0; i < crowd.length; i++) {
      const dummy = new THREE.Object3D();
      dummy.position.set(0, -100, 0);
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      crowdSnow.setMatrixAt(i, dummy.matrix);
    }
    crowdSnow.instanceMatrix.needsUpdate = true;
    world.add(crowdBodies, crowdHeads, crowdHats, crowdSnow);
  })();

  // Hats and scarves thrown into the air when a house scores or is cheered.
  const TOSS_COUNT = 58;
  const tossMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(.16, .14, .03),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
    TOSS_COUNT
  );
  tossMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tossMesh.frustumCulled = false;
  tossMesh.castShadow = false;
  world.add(tossMesh);
  const tossItems = [];
  const tossDummy = new THREE.Object3D();
  let tossCursor = 0;
  for (let i = 0; i < TOSS_COUNT; i++) {
    tossItems.push({
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      age: 0,
      life: 0,
      spin: 0,
      scale: 1
    });
    tossDummy.position.set(0, -100, 0);
    tossDummy.scale.setScalar(0);
    tossDummy.updateMatrix();
    tossMesh.setMatrixAt(i, tossDummy.matrix);
    tossMesh.setColorAt(i, new THREE.Color(0xd6ae58));
  }
  tossMesh.instanceColor.needsUpdate = true;

  function tossCelebration(houseKey, count) {
    const house = HOUSE[houseKey];
    if (!house) return;
    const colors = [house.main, house.light, house.deep, 0xf2e7c7, 0xd8b36c];
    const amount = Math.min(TOSS_COUNT, count || 14);
    for (let i = 0; i < amount; i++) {
      const item = tossItems[tossCursor];
      const fan = crowd[Math.floor(Math.random() * crowd.length)];
      const towardField = -Math.sign(fan.z || 1);
      tossCursor = (tossCursor + 1) % TOSS_COUNT;
      item.active = true;
      item.pos.set(
        fan.x + rr(-.28, .28),
        fan.y + rr(1.0, 1.45),
        fan.z + towardField * rr(.7, 1.4)
      );
      item.vel.set(rr(-1.4, 1.4), rr(2.5, 4.6), towardField * rr(1.1, 2.2));
      item.age = 0;
      item.life = rr(1.9, 3.0);
      item.spin = rr(-7, 7);
      item.scale = rr(1.2, 2.0);
    }
    for (let i = 0; i < amount; i++) {
      const idx = (tossCursor - amount + i + TOSS_COUNT) % TOSS_COUNT;
      tossMesh.setColorAt(idx, new THREE.Color(colors[Math.floor(Math.random() * colors.length)]));
    }
    tossMesh.instanceColor.needsUpdate = true;
  }

  function updateToss(dt) {
    for (let i = 0; i < TOSS_COUNT; i++) {
      const item = tossItems[i];
      if (item.active) {
        item.age += dt;
        if (item.age >= item.life) {
          item.active = false;
        } else {
          item.vel.y -= 4.4 * dt;
          item.pos.addScaledVector(item.vel, dt);
          const life = 1 - item.age / item.life;
          tossDummy.position.copy(item.pos);
          tossDummy.rotation.set(item.age * item.spin, item.age * item.spin * .8, item.age * item.spin * .5);
          tossDummy.scale.setScalar(item.scale * Math.min(1, life * 2.5));
        }
      }
      if (!item.active) {
        tossDummy.position.set(0, -100, 0);
        tossDummy.scale.setScalar(0);
      }
      tossDummy.updateMatrix();
      tossMesh.setMatrixAt(i, tossDummy.matrix);
    }
    tossMesh.instanceMatrix.needsUpdate = true;
  }

  function updateCrowd(t) {
    const dummy = new THREE.Object3D();
    let hi = 0;
    const excitement = Math.max(0, crowdExcitement);
    const cheerKey = houseCheer.time > 0 ? houseCheer.key : '';
    for (let i = 0; i < crowd.length; i++) {
      const s = crowd[i];
      // A slow travelling ripple, amplified when the match boils over.
      let bounce = Math.sin(t * s.speed + s.phase + s.x * .42) * s.amp * (1 + excitement * 2.7);
      if (cheerKey && s.house.key === cheerKey) {
        bounce += Math.sin(t * 10 + s.phase) * .055 * Math.min(1, houseCheer.time);
      }
      dummy.position.set(s.x, s.y + .17 + bounce, s.z);
      dummy.rotation.set(0, s.z > 0 ? Math.PI : 0, Math.sin(t * .7 + s.phase) * .02);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      crowdBodies.setMatrixAt(i, dummy.matrix);

      dummy.position.y = s.y + .41 + bounce;
      dummy.rotation.set(0, 0, Math.sin(t * s.speed + s.phase) * .105);
      dummy.updateMatrix();
      crowdHeads.setMatrixAt(i, dummy.matrix);

      if (s.hat) {
        dummy.position.y = s.y + .51 + bounce;
        dummy.rotation.set(0, s.phase, Math.sin(t * s.speed + s.phase) * .09);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        crowdHats.setMatrixAt(hi++, dummy.matrix);
      }

      if (crowdSnow && crowdSnow.visible) {
        dummy.position.set(s.x, s.y + .47 + bounce, s.z);
        dummy.rotation.set(0, s.phase, 0);
        dummy.scale.set(1.15, .38, 1.15);
        dummy.updateMatrix();
        crowdSnow.setMatrixAt(i, dummy.matrix);
      }
    }
    crowdBodies.instanceMatrix.needsUpdate = true;
    crowdHeads.instanceMatrix.needsUpdate = true;
    crowdHats.instanceMatrix.needsUpdate = true;
    if (crowdSnow && crowdSnow.visible) crowdSnow.instanceMatrix.needsUpdate = true;
  }

  /* -----------------------------------------------------------------------
     Banners and cloth
     ----------------------------------------------------------------------- */
  function drawIcon(ctx, house, cx, cy, scale) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ead28a';
    ctx.strokeStyle = '#ead28a';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (house.key === 'gryffindor') {
      // Stylised lion: mane, face, and a bold curled tail.
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2;
        const r = i % 2 ? 19 : 27;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = house.deep;
      ctx.beginPath();
      ctx.arc(0, -1, 12.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ead28a';
      ctx.beginPath();
      ctx.arc(-4.2, -4, 2.1, 0, 6.3);
      ctx.arc(4.2, -4, 2.1, 0, 6.3);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-4, 4); ctx.lineTo(0, 7.5); ctx.lineTo(4, 4); ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(12, 10);
      ctx.quadraticCurveTo(30, 15, 24, -9);
      ctx.stroke();
    } else if (house.key === 'slytherin') {
      // Serpent in a loose S.
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(-20, -21);
      ctx.bezierCurveTo(15, -26, 22, -6, -3, -3);
      ctx.bezierCurveTo(-27, 0, -25, 20, 4, 16);
      ctx.bezierCurveTo(22, 13, 25, 5, 18, -1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(18, -4); ctx.lineTo(30, -11); ctx.lineTo(27, 3); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = house.deep;
      ctx.beginPath();
      ctx.arc(23, -4, 1.7, 0, 6.3);
      ctx.fill();
    } else if (house.key === 'ravenclaw') {
      // Spread eagle.
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.lineTo(-30, -14); ctx.lineTo(-20, 0); ctx.lineTo(-33, 4);
      ctx.lineTo(-13, 8); ctx.lineTo(-21, 23); ctx.lineTo(-5, 13);
      ctx.lineTo(0, 24); ctx.lineTo(5, 13); ctx.lineTo(21, 23);
      ctx.lineTo(13, 8); ctx.lineTo(33, 4); ctx.lineTo(20, 0);
      ctx.lineTo(30, -14); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = house.deep;
      ctx.beginPath();
      ctx.arc(0, 1, 5, 0, 6.3);
      ctx.fill();
    } else {
      // Badger with a striped face.
      ctx.beginPath();
      ctx.ellipse(0, 7, 25, 17, 0, 0, 6.3);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-21, 0);
      ctx.lineTo(-16, -24); ctx.lineTo(-4, -10); ctx.lineTo(4, -10);
      ctx.lineTo(16, -24); ctx.lineTo(21, 0); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = house.deep;
      ctx.beginPath();
      ctx.ellipse(0, -2, 7, 10, 0, 0, 6.3);
      ctx.fill();
      ctx.fillStyle = '#ead28a';
      ctx.beginPath();
      ctx.arc(-7, 5, 2.2, 0, 6.3);
      ctx.arc(7, 5, 2.2, 0, 6.3);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 8, 2.8, 0, 6.3);
      ctx.fill();
    }
    ctx.restore();
  }

  function makeBannerTexture(house) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 208;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);

    // Swallow-tail banner silhouette.
    ctx.beginPath();
    ctx.moveTo(5, 4);
    ctx.lineTo(123, 4);
    ctx.lineTo(123, 176);
    ctx.lineTo(92, 199);
    ctx.lineTo(64, 183);
    ctx.lineTo(36, 199);
    ctx.lineTo(5, 176);
    ctx.closePath();
    ctx.fillStyle = '#' + new THREE.Color(house.main).getHexString();
    ctx.fill();
    ctx.save();
    ctx.clip();

    // Woven bands and a subtle vertical weave.
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    for (let x = 10; x < 128; x += 11) ctx.fillRect(x, 0, 1, 208);
    ctx.fillStyle = 'rgba(0,0,0,.12)';
    ctx.fillRect(0, 0, 9, 208);
    ctx.fillRect(119, 0, 9, 208);
    ctx.fillRect(0, 0, 128, 8);
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(0, 9, 128, 3);

    // Gold border and crest.
    ctx.strokeStyle = 'rgba(231, 201, 124, .9)';
    ctx.lineWidth = 4;
    ctx.strokeRect(13, 16, 102, 160);
    ctx.strokeStyle = 'rgba(231, 201, 124, .35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(20, 23, 88, 146);

    // A miniature shield behind the icon.
    ctx.beginPath();
    ctx.moveTo(38, 46);
    ctx.lineTo(90, 46);
    ctx.lineTo(90, 114);
    ctx.quadraticCurveTo(64, 141, 38, 114);
    ctx.closePath();
    ctx.fillStyle = 'rgba(18, 16, 13, .21)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(231, 201, 124, .55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawIcon(ctx, house, 64, 90, 1.0);

    ctx.fillStyle = 'rgba(239, 221, 171, .96)';
    ctx.textAlign = 'center';
    ctx.font = '600 10px Georgia, serif';
    ctx.fillText(house.name.toUpperCase(), 64, 167);
    ctx.fillStyle = 'rgba(239, 221, 171, .6)';
    ctx.font = '8px Georgia, serif';
    ctx.fillText('HOGWARTS', 64, 36);

    // A faint gold fringe at the swallow-tail.
    ctx.strokeStyle = 'rgba(231, 201, 124, .58)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(7, 176); ctx.lineTo(36, 195); ctx.lineTo(64, 180);
    ctx.lineTo(92, 195); ctx.lineTo(120, 176);
    ctx.stroke();
    ctx.restore();

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  }

  function makeHousePanelTexture(house) {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#' + new THREE.Color(house.main).getHexString();
    ctx.fillRect(0, 0, c.width, c.height);

    // Subtle woven folds.
    for (let x = 0; x < c.width; x += 18) {
      ctx.fillStyle = 'rgba(255,255,255,.028)';
      ctx.fillRect(x, 0, 2, c.height);
      ctx.fillStyle = 'rgba(0,0,0,.035)';
      ctx.fillRect(x + 9, 0, 3, c.height);
    }
    const sideShade = ctx.createLinearGradient(0, 0, 96, 0);
    sideShade.addColorStop(0, 'rgba(0,0,0,.22)');
    sideShade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sideShade;
    ctx.fillRect(0, 0, 96, c.height);
    const sideShade2 = ctx.createLinearGradient(c.width, 0, c.width - 96, 0);
    sideShade2.addColorStop(0, 'rgba(0,0,0,.22)');
    sideShade2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sideShade2;
    ctx.fillRect(c.width - 96, 0, 96, c.height);

    // Woven house ribbon border.
    ctx.fillStyle = '#' + new THREE.Color(house.light).getHexString();
    ctx.fillRect(0, 0, c.width, 7);
    ctx.fillRect(0, c.height - 7, c.width, 7);
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(0, 7, c.width, 2);
    ctx.fillRect(0, c.height - 9, c.width, 2);

    // Symmetric gold diamond motifs at the edges.
    ctx.save();
    ctx.strokeStyle = 'rgba(240,213,143,.72)';
    ctx.fillStyle = 'rgba(240,213,143,.5)';
    ctx.lineWidth = 2;
    for (const cx of [58, c.width - 58]) {
      ctx.beginPath();
      ctx.moveTo(cx, 31);
      ctx.lineTo(cx + 13, 48);
      ctx.lineTo(cx, 65);
      ctx.lineTo(cx - 13, 48);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, 48, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Central shield with the house animal.
    ctx.save();
    ctx.translate(c.width / 2, 48);
    ctx.beginPath();
    ctx.moveTo(-31, -30);
    ctx.lineTo(31, -30);
    ctx.lineTo(31, 2);
    ctx.quadraticCurveTo(30, 26, 0, 37);
    ctx.quadraticCurveTo(-30, 26, -31, 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(13,11,9,.2)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,213,143,.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
    drawIcon(ctx, house, 0, -2, .48);
    ctx.restore();

    // A small title, readable when the camera zooms in close.
    ctx.fillStyle = 'rgba(244,227,183,.78)';
    ctx.font = '600 10px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(house.name.toUpperCase(), c.width / 2, 78);

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  }

  function makeFlagTexture(house) {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#' + new THREE.Color(house.main).getHexString();
    ctx.fillRect(0, 0, 96, 64);
    ctx.fillStyle = '#' + new THREE.Color(house.light).getHexString();
    ctx.fillRect(0, 0, 96, 8);
    ctx.fillRect(0, 56, 96, 8);
    ctx.fillRect(0, 0, 8, 64);
    ctx.fillStyle = 'rgba(18,16,12,.18)';
    ctx.fillRect(0, 8, 96, 2);
    ctx.fillRect(0, 54, 96, 2);
    ctx.strokeStyle = 'rgba(238,212,145,.65)';
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, 68, 36);
    ctx.fillStyle = 'rgba(238,212,145,.9)';
    ctx.beginPath();
    ctx.arc(48, 32, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#' + new THREE.Color(house.main).getHexString();
    ctx.font = 'bold 11px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(house.name[0], 48, 33);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  }

  const clothAnimations = [];
  function makeHangingCloth(width, height, texture, amp, phase) {
    const geo = new THREE.PlaneGeometry(width, height, 7, 12);
    geo.translate(0, -height / 2, 0);
    const base = Float32Array.from(geo.attributes.position.array);
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.52,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
      flatShading: true
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.cloth = { kind: 'hang', base, amp, phase, width, height };
    clothAnimations.push(mesh);
    return mesh;
  }

  function makeFlyingFlag(width, height, texture, amp, phase) {
    const geo = new THREE.PlaneGeometry(width, height, 12, 5);
    geo.translate(width / 2, 0, 0);
    const base = Float32Array.from(geo.attributes.position.array);
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
      flatShading: true
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cloth = { kind: 'flag', base, amp, phase, width, height };
    clothAnimations.push(mesh);
    return mesh;
  }

  function animateClothMeshes(t) {
    const gust = 0.5 + weatherWind * 0.62;
    const time = t * (0.8 + weatherWind * 0.23);
    for (const mesh of clothAnimations) {
      const cloth = mesh.userData.cloth;
      const pos = mesh.geometry.attributes.position;
      const arr = pos.array;
      const base = cloth.base;
      if (cloth.kind === 'hang') {
        for (let i = 0; i < pos.count; i++) {
          const x = base[i * 3];
          const y = base[i * 3 + 1];
          const v = clamp(-y / cloth.height, 0, 1);
          const z = Math.sin(time * 1.55 + cloth.phase + v * 3.3 + x * 2.35) * cloth.amp * gust * (0.22 + v * 0.95);
          arr[i * 3] = x + Math.sin(time * 1.15 + cloth.phase + v * 2) * 0.018 * v;
          arr[i * 3 + 2] = z;
        }
      } else {
        for (let i = 0; i < pos.count; i++) {
          const x = base[i * 3];
          const v = x / cloth.width;
          arr[i * 3 + 2] = Math.sin(time * 3.2 + cloth.phase + v * 5.4) * cloth.amp * v * gust;
          arr[i * 3 + 1] = base[i * 3 + 1] + Math.sin(time * 2.5 + cloth.phase + v * 4) * cloth.amp * v * .35 * gust;
        }
      }
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
  }

  // Banners hang from the far grandstand.
  const bannerBeam = new THREE.Group();
  addBox(bannerBeam, 24.9, .13, .13, M.woodDark, 0, 3.08, -11.10, true, true);
  for (const x of [-12.15, 12.15]) {
    addBox(bannerBeam, .18, 3.1, .18, M.woodDark, x, 1.55, -11.10, true, true);
    addCone(bannerBeam, .15, .33, 6, M.gold, x, 3.24, -11.10, false, false);
  }
  world.add(bannerBeam);

  const bannerHouseOrder = ['gryffindor', 'ravenclaw', 'slytherin', 'hufflepuff'];
  bannerHouseOrder.forEach((key, i) => {
    const house = HOUSE[key];
    const tex = makeBannerTexture(house);
    const banner = makeHangingCloth(1.62, 2.62, tex, 0.18, i * 1.6);
    banner.position.set([-8.85, -2.95, 2.95, 8.85][i], 3.01, -10.93);
    banner.rotation.y = 0;
    world.add(banner);
  });

  // A modest string of pennants beneath the beam.
  (function addPennants() {
    const colors = [0x8b2634, 0xd6ae58, 0x245b47, 0xb6c5b2, 0x2d4674, 0xb89355, 0xc69a28, 0x2e2a22];
    const shape = new THREE.Shape();
    shape.moveTo(-.09, 0);
    shape.lineTo(.09, 0);
    shape.lineTo(0, -.24);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    for (let i = 0; i < 25; i++) {
      const x = -11.6 + i * .97;
      const mat = new THREE.MeshStandardMaterial({
        color: colors[i % colors.length], roughness: 1, side: THREE.DoubleSide, flatShading: true
      });
      const flag = new THREE.Mesh(geo, mat);
      flag.position.set(x, 3.00 - 0.02 * Math.sin(i / 24 * Math.PI), -11.14);
      flag.rotation.z = Math.PI;
      flag.castShadow = false;
      world.add(flag);
    }
  })();

  /* -----------------------------------------------------------------------
     Towers, castle, flags and architecture
     ----------------------------------------------------------------------- */
  function addWindow(parent, x, y, z, angle, scale, mat) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(.16, .26, .035), M.stoneDark);
    frame.castShadow = false;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(.10, .17), mat || M.windowGlow);
    pane.position.z = .022;
    g.add(frame, pane);
    g.position.set(x, y, z);
    g.rotation.y = angle;
    g.scale.setScalar(scale || 1);
    parent.add(g);
    return g;
  }

  function buildTower(options) {
    const { x, z, radius, height, roofHeight, roofColor, flagHouse, scale = 1 } = options;
    const g = new THREE.Group();
    g.position.set(x, 0.02, z);

    const bodyMat = material(options.stoneColor || 0xcabc9f);
    const bandMat = material(options.bandColor || 0xe8ddc5);
    const body = addCylinder(g, radius * .91, radius, height, 10, bodyMat, 0, height / 2, 0, true, true);
    body.rotation.y = options.rotation || 0;

    // Stone banding.
    for (const yy of [height * .28, height * .62, height * .9]) {
      addCylinder(g, radius * 1.02, radius * 1.02, .10, 10, bandMat, 0, yy, 0, false, true);
    }

    // Crenellated parapet.
    addCylinder(g, radius * 1.14, radius * 1.14, .22, 10, bodyMat, 0, height + .11, 0, true, true);
    const merlons = 8;
    for (let i = 0; i < merlons; i++) {
      const a = i / merlons * Math.PI * 2;
      const mm = addBox(g, .19, .27, .22, bodyMat,
        Math.sin(a) * radius * 1.02, height + .33, Math.cos(a) * radius * 1.02, true, true);
      mm.rotation.y = a;
    }

    const roof = addCone(g, radius * 1.18, roofHeight, 10,
      material(roofColor || 0x3f5558, { roughness: .9 }), 0, height + .33 + roofHeight / 2, 0, true, true);
    roof.rotation.y = options.rotation ? options.rotation + .18 : .18;
    addSnowRoof(g, roof, 1.018);

    addCylinder(g, .045, .045, .55, 5, M.goldDark, 0, height + .33 + roofHeight + .25, 0, false, false);
    addMesh(g, new THREE.SphereGeometry(.11, 6, 5), M.gold, 0, height + .33 + roofHeight + .54, 0, false, false);

    if (flagHouse) {
      const poleHeight = height + .33 + roofHeight + .54;
      addCylinder(g, .025, .025, 1.32, 5, M.woodDark, 0, poleHeight + .45, 0, false, false);
      addMesh(g, new THREE.SphereGeometry(.055, 6, 5), M.gold, 0, poleHeight + 1.13, 0, false, false);
      const flag = makeFlyingFlag(1.18, .62, makeFlagTexture(HOUSE[flagHouse]), .19, options.flagPhase || 0);
      flag.position.set(0, poleHeight + .98, 0);
      flag.rotation.y = options.flagRotation === undefined ? -.35 : options.flagRotation;
      g.add(flag);
    }

    // Windows facing the sunny camera quadrant.
    const winAngles = [.5, 1.1, -.25];
    for (let i = 0; i < winAngles.length; i++) {
      const a = winAngles[i];
      const yy = height * (.40 + i * .18);
      addWindow(g, Math.sin(a) * radius * .98, yy, Math.cos(a) * radius * .98, a, 1);
    }

    // Ivy / moss accents at the foot.
    for (let i = 0; i < 4; i++) {
      const a = rr(0, Math.PI * 2);
      const m = addBox(g, rr(.16, .28), rr(.12, .26), rr(.05, .11),
        material(0x5d7647), Math.sin(a) * radius * .95, rr(.15, .8), Math.cos(a) * radius * .95, false, true);
      m.rotation.y = a;
    }

    world.add(g);
    g.scale.setScalar(scale);
    return g;
  }

  const cornerTowers = [
    { x: -16.6, z: 10.55, radius: .72, height: 3.15, roofHeight: 1.52, roofColor: 0x806622, flagHouse: 'hufflepuff', flagPhase: .3, flagRotation: -.6 },
    { x: 16.6, z: 10.55, radius: .76, height: 3.4, roofHeight: 1.65, roofColor: 0x6d2730, flagHouse: 'gryffindor', flagPhase: 1.2, flagRotation: -2.55 },
    { x: -16.6, z: -10.55, radius: .76, height: 3.55, roofHeight: 1.68, roofColor: 0x2b4161, flagHouse: 'ravenclaw', flagPhase: 2.1, flagRotation: .45 },
    { x: 16.6, z: -10.55, radius: .7, height: 3.15, roofHeight: 1.45, roofColor: 0x244b3b, flagHouse: 'slytherin', flagPhase: 2.8, flagRotation: 2.2 }
  ];
  for (const t of cornerTowers) buildTower(t);

  // A Hogwarts-like cluster behind the far stand.
  const castleGroup = new THREE.Group();
  world.add(castleGroup);

  function castleTower(x, z, radius, height, roofHeight, roofColor, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const stone = material(opts.stone || 0xc0ad8a);
    addCylinder(g, radius * .9, radius, height, 9, stone, 0, height / 2, 0, true, true);
    addCylinder(g, radius * 1.06, radius * 1.06, .16, 9, material(opts.band || 0xe1d2b6), 0, height * .78, 0, false, true);
    addCylinder(g, radius * 1.1, radius * 1.1, .19, 9, stone, 0, height + .09, 0, true, true);
    const roof = addCone(g, radius * 1.22, roofHeight, 9,
      material(roofColor || 0x41545a), 0, height + .19 + roofHeight / 2, 0, true, true);
    addSnowRoof(g, roof, 1.018);
    addCylinder(g, .028, .028, .55, 4, M.goldDark, 0, height + .19 + roofHeight + .2, 0, false, false);
    if (opts.flag) {
      const flag = makeFlyingFlag(.85, .44, makeFlagTexture(HOUSE[opts.flag]), .14, opts.phase || 0);
      flag.position.set(0, height + .19 + roofHeight + .23, 0);
      flag.rotation.y = -.2;
      g.add(flag);
    }
    for (let i = 0; i < 3; i++) {
      const a = .42 + i * .95;
      addWindow(g, Math.sin(a) * radius * .95, height * (.35 + i * .19), Math.cos(a) * radius * .95, a, .85);
    }
    castleGroup.add(g);
    return g;
  }

  // A low curtain wall with battlements.
  addBox(castleGroup, 16.8, 2.25, .38, material(0xb5a180), -1.6, 1.12, -11.62, true, true);
  for (let x = -9.7; x <= 6.7; x += 1.15) {
    addBox(castleGroup, .58, .46, .46, material(0xc3b08f), x, 2.45, -11.62, true, true);
    addSnowBox(castleGroup, .52, .035, .4, x, 2.69, -11.62);
  }
  addSnowBox(castleGroup, 16.9, .045, .3, -1.6, 2.7, -11.62);
  for (let i = 0; i < 7; i++) {
    addBox(castleGroup, .11, .2, .05, M.windowGlow, -8.6 + i * 2.42, 1.55, -11.42, false, false);
  }

  castleTower(-7.35, -11.18, .70, 3.58, 1.48, 0x3c5159, { flag: 'ravenclaw', phase: .8 });
  castleTower(-1.25, -11.85, .98, 5.02, 2.02, 0x35494f, { flag: 'gryffindor', phase: 1.5, stone: 0xc8b594 });
  castleTower(4.2, -11.35, .58, 2.96, 1.33, 0x455b5f, {});
  castleTower(7.9, -11.68, .76, 3.72, 1.58, 0x3b5056, { flag: 'slytherin', phase: 2.9 });

  // Central clock, a tiny but readable Hogwarts cue.
  (function addClock() {
    const g = new THREE.Group();
    g.position.set(-1.25, 4.15, -10.875);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(.52, .52, .07, 18), material(0xeee3ca));
    face.rotation.x = Math.PI / 2;
    face.castShadow = false;
    g.add(face);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.53, .045, 4, 18), M.gold);
    ring.position.z = .045;
    g.add(ring);
    const hand1 = new THREE.Mesh(new THREE.BoxGeometry(.045, .34, .035), M.ink);
    hand1.position.set(0, .13, .08);
    const hand2 = new THREE.Mesh(new THREE.BoxGeometry(.27, .04, .035), M.ink);
    hand2.position.set(.10, 0, .08);
    hand2.rotation.z = -.22;
    g.add(hand1, hand2);
    world.add(g);
  })();

  // Little conical trees tucked into the far corners.
  (function trees() {
    const treeMat = material(0x3f603e, { roughness: 1 });
    const trunkMat = material(0x5b412c);
    const spots = [[-13.9, -9.9, 1], [14.1, -9.8, .9], [-13.95, 9.35, .8], [14.0, 9.4, .72]];
    for (const [x, z, s] of spots) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      addCylinder(g, .07, .1, .55, 5, trunkMat, 0, .27, 0, true, false);
      const tier1 = addCone(g, .5, 1.5, 6, treeMat, 0, 1.12, 0, true, false);
      addSnowRoof(g, tier1, 1.02);
      const tier2 = addCone(g, .37, 1.1, 6, treeMat, 0, 1.65, 0, true, false);
      addSnowRoof(g, tier2, 1.02);
      const tier3 = addCone(g, .23, .8, 6, treeMat, 0, 2.1, 0, true, false);
      addSnowRoof(g, tier3, 1.02);
      g.scale.setScalar(s);
      world.add(g);
    }
  })();

  /* -----------------------------------------------------------------------
     The Hogwarts grounds behind the pitch: a larger castle silhouette,
     a rocky plateau, forest edge, mist, window light and floating candles.
     It stays intentionally low-contrast so the pitch remains the subject.
     ----------------------------------------------------------------------- */
  const grounds = new THREE.Group();
  grounds.position.x = -2.0;
  world.add(grounds);

  function makeCastleStoneTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ddd1bc';
    ctx.fillRect(0, 0, 128, 128);
    let seed = 17;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const rowH = 16;
    for (let row = 0; row < 8; row++) {
      const offset = (row % 2) * 16;
      for (let bx = -1; bx < 5; bx++) {
        const x = bx * 32 + offset;
        const y = row * rowH;
        const l = Math.floor(rnd() * 12);
        ctx.fillStyle = `rgb(${220 - l},${208 - l},${187 - l})`;
        ctx.fillRect(x + 1, y + 1, 30, rowH - 2);
        ctx.strokeStyle = 'rgba(111,98,79,.23)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + .5, y + .5, 31, rowH - 1);
      }
    }
    for (let i = 0; i < 160; i++) {
      const a = rnd() * .075;
      ctx.fillStyle = rnd() > .5 ? `rgba(80,67,52,${a})` : `rgba(255,248,232,${a})`;
      ctx.fillRect(Math.floor(rnd() * 128), Math.floor(rnd() * 128), 1 + Math.floor(rnd() * 3), 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function makeCastleSlateTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#46595e';
    ctx.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 8) {
      for (let x = 0; x < 64; x += 12) {
        const off = (y / 8) % 2 ? 6 : 0;
        const l = 3 + ((x * 7 + y * 3) % 10);
        ctx.fillStyle = `rgb(${59 + l},${73 + l},${77 + l})`;
        ctx.fillRect(x + off + 1, y + 1, 10, 6);
      }
      ctx.fillStyle = 'rgba(24,35,39,.34)';
      ctx.fillRect(0, y, 64, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const bdStoneTex = makeCastleStoneTexture();
  const bdSlateTex = makeCastleSlateTexture();
  const bdStone = material(0xe0d2bc, { roughness: 1, flatShading: true, map: bdStoneTex });
  const bdStoneLight = material(0xf5e8d4, { roughness: 1, flatShading: true, map: bdStoneTex });
  const bdStoneDark = material(0xa89980, { roughness: 1, flatShading: true, map: bdStoneTex });
  const bdRoof = material(0xffffff, { roughness: .92, flatShading: true, map: bdSlateTex });
  const bdRoofDark = material(0xa8b3b5, { roughness: .92, flatShading: true, map: bdSlateTex });
  const bdRock = material(0x867964, { roughness: 1, flatShading: true });
  const bdGrass = material(0x5b6a51, { roughness: 1, flatShading: true });
  const bdPine = material(0x405846, { roughness: 1, flatShading: true });
  const bdPineDark = material(0x344a3d, { roughness: 1, flatShading: true });

  // A low oval plateau gives the castle its own piece of ground while keeping
  // the pitch on its original cream slab.
  const plateau = addMesh(grounds,
    new THREE.CylinderGeometry(1, 1.08, 1, 18),
    material(0x776b59, { roughness: 1, flatShading: true }),
    0, 0, -17.2, true, true);
  plateau.scale.set(16.6, 3.7, 6.3);
  const plateauSkirt = addMesh(grounds,
    new THREE.CylinderGeometry(1, 1.12, 1, 18),
    material(0x695f50, { roughness: 1, flatShading: true }),
    0, -.75, -17.2, true, true);
  plateauSkirt.scale.set(17.3, 2.5, 6.8);
  const plateauTop = addMesh(grounds,
    new THREE.CylinderGeometry(1, 1, .08, 18),
    material(0x4f6049, { roughness: 1, flatShading: true }),
    0, 1.84, -17.2, false, true);
  plateauTop.scale.set(15.9, 1, 5.85);

  // Rocky outcrops and a few pale boulders soften the plateau's silhouette.
  const boulderSpots = [
    [-16.2, -14.2, 1.4, .65], [-13.8, -12.8, .9, .45],
    [15.8, -14.8, 1.2, .6], [12.8, -12.6, .75, .4],
    [-11.0, -18.8, 1.15, .5], [9.4, -19.6, .9, .4]
  ];
  for (const [x, z, s, lift] of boulderSpots) {
    const rock = addMesh(grounds, new THREE.DodecahedronGeometry(1, 0), bdRock,
      x, 1.82 + lift, z, true, true);
    rock.scale.set(s, s * .6, s * .85);
    rock.rotation.set(rr(-.12, .12), rr(0, 6.28), rr(-.1, .1));
  }

  // A broad contact shadow makes the hill feel planted in the white studio
  // instead of floating behind the pitch.
  const hillShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 27),
    new THREE.MeshBasicMaterial({
      map: makeShadowBlobTexture(),
      transparent: true,
      opacity: .62,
      depthWrite: false
    })
  );
  hillShadow.rotation.x = -Math.PI / 2;
  hillShadow.position.set(1.2, -2.57, -13.2);
  hillShadow.renderOrder = 1;
  world.add(hillShadow);

  function addGableRoof(parent, width, height, depth, mat, x, y, z) {
    // The ridge runs along X; the triangle is cut in the Z/Y plane.
    const shape = new THREE.Shape();
    shape.moveTo(-depth / 2, 0);
    shape.lineTo(depth / 2, 0);
    shape.lineTo(0, height);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    geo.translate(0, 0, -width / 2);
    geo.rotateY(Math.PI / 2);
    return addMesh(parent, geo, mat, x, y, z, true, true);
  }

  function addGreatWindow(parent, x, y, z, angle, scale) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = angle;
    g.scale.setScalar(scale || 1);
    addBox(g, .58, 1.95, .08, M.stoneDark, 0, 0, 0, false, false);
    addBox(g, .35, 1.55, .025, M.windowGlow, 0, 0, .055, false, false);
    addBox(g, .035, 1.55, .03, M.stoneDark, 0, 0, .073, false, false);
    addBox(g, .35, .035, .03, M.stoneDark, 0, .18, .073, false, false);
    addCone(g, .33, .36, 4, M.stoneDark, 0, 1.12, .01, false, false).rotation.y = Math.PI / 4;
    parent.add(g);
    return g;
  }

  // The Great Hall: long, low, many warm windows.
  const hall = new THREE.Group();
  hall.position.set(-2.7, 1.84, -17.9);
  grounds.add(hall);
  addBox(hall, 10.9, 4.7, 5.2, bdStone, 0, 2.35, 0, true, true);
  addBox(hall, 11.45, .45, 5.65, bdStoneDark, 0, .22, 0, true, true);
  for (const x of [-4.7, -2.35, 0, 2.35, 4.7]) {
    addBox(hall, .42, 5.0, .56, bdStoneLight, x, 2.5, 2.72, true, true);
    addCone(hall, .28, .6, 5, bdStoneLight, x, 5.3, 2.72, true, true);
  }
  for (const z of [-2.35, 2.35]) {
    addBox(hall, .5, 5.0, .42, bdStoneLight, 5.38, 2.5, z, true, true);
    addCone(hall, .3, .62, 5, bdStoneLight, 5.38, 5.3, z, true, true);
  }
  const hallRoof = addGableRoof(hall, 11.5, 3.35, 5.85, bdRoof, 0, 4.7, 0);
  addSnowRoof(hall, hallRoof, 1.017);
  addBox(hall, 11.7, .08, .16, M.goldDark, 0, 8.07, 0, false, false);
  addCylinder(hall, .075, .095, 2.1, 5, M.goldDark, 0, 7.75, 0, false, false);
  addMesh(hall, new THREE.SphereGeometry(.14, 6, 5), M.gold, 0, 8.85, 0, false, false);
  for (const x of [-4.15, -1.4, 1.4, 4.15]) {
    addGreatWindow(hall, x, 3.35, 2.68, 0, 1);
  }
  for (const z of [-1.8, 0, 1.8]) {
    addGreatWindow(hall, 5.48, 3.25, z, Math.PI / 2, 1);
    addGreatWindow(hall, 5.48, 4.72, z, Math.PI / 2, .62);
  }
  for (const x of [-4.4, 3.8]) {
    addCylinder(hall, .34, .4, 1.05, 8, bdStone, x, 8.05, 0, true, true);
    const turretRoof = addCone(hall, .48, .82, 8, bdRoofDark, x, 8.98, 0, true, true);
    addSnowRoof(hall, turretRoof, 1.02);
    addWindow(hall, x, 8.3, .4, 0, .8);
  }
  addMesh(hall, new THREE.CircleGeometry(.64, 16), M.windowGlow,
    5.48, 5.2, 0, false, false).rotation.y = Math.PI / 2;
  addMesh(hall, new THREE.TorusGeometry(.67, .055, 4, 16), M.gold,
    5.49, 5.2, 0, false, false).rotation.y = Math.PI / 2;
  addMesh(hall, new THREE.CircleGeometry(.42, 14), M.windowGlow,
    0, 4.25, 2.68, false, false);
  addMesh(hall, new THREE.TorusGeometry(.45, .045, 4, 14), M.gold,
    0, 4.25, 2.69, false, false);

  // A square clock tower rises through the Hall roof, breaking up the long
  // silhouette and giving the castle its most recognisable Hogwarts cue.
  (function addHallClockTower() {
    const g = new THREE.Group();
    g.position.set(-2.7, 6.0, -17.9);
    grounds.add(g);
    addBox(g, 1.95, 5.0, 1.95, bdStone, 0, 2.5, 0, true, true);
    for (const x of [-.95, .95]) {
      for (const z of [-.95, .95]) {
        addBox(g, .24, 5.3, .24, bdStoneLight, x, 2.6, z, true, true);
      }
    }
    addBox(g, 2.3, .22, 2.3, bdStoneLight, 0, 5.05, 0, true, true);
    const roof = addCone(g, 1.7, 2.05, 4, bdRoof, 0, 6.2, 0, true, true);
    roof.rotation.y = Math.PI / 4;
    addSnowRoof(g, roof, 1.02);
    addCylinder(g, .035, .035, 1.0, 4, M.goldDark, 0, 7.5, 0, false, false);
    addMesh(g, new THREE.SphereGeometry(.1, 6, 5), M.gold, 0, 8.03, 0, false, false);
    const face = new THREE.Group();
    face.position.set(0, 4.0, .99);
    addMesh(face, new THREE.CylinderGeometry(.55, .55, .06, 18), material(0xeee3ca),
      0, 0, 0, false, false).rotation.x = Math.PI / 2;
    addMesh(face, new THREE.TorusGeometry(.56, .05, 4, 18), M.gold, 0, 0, .04, false, false);
    addMesh(face, new THREE.BoxGeometry(.035, .34, .03), M.ink, 0, .11, .08, false, false);
    addMesh(face, new THREE.BoxGeometry(.28, .035, .03), M.ink, .08, 0, .08, false, false).rotation.z = -.25;
    g.add(face);
    addBox(g, .48, .95, .05, M.windowGlow, 0, 2.15, .99, false, false);
  })();

  function backdropTower(x, z, radius, height, roofHeight, roofColor, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    g.position.set(x, 1.84, z);
    grounds.add(g);
    addCylinder(g, radius * .9, radius, height, 10, opts.stone || bdStone, 0, height / 2, 0, true, true);
    addCylinder(g, radius * 1.02, radius * 1.02, .07, 10, bdStoneDark, 0, height * .44, 0, false, true);
    addCylinder(g, radius * 1.04, radius * 1.04, .14, 10, bdStoneLight, 0, height * .72, 0, false, true);
    addCylinder(g, radius * 1.12, radius * 1.12, .2, 10, opts.stone || bdStone, 0, height + .1, 0, true, true);
    const merlons = 8;
    for (let i = 0; i < merlons; i++) {
      const a = i / merlons * Math.PI * 2;
      const m = addBox(g, .18, .26, .2, bdStoneLight,
        Math.sin(a) * radius * 1.02, height + .32, Math.cos(a) * radius * 1.02, true, true);
      m.rotation.y = a;
    }
    const roof = addCone(g, radius * 1.23, roofHeight, 10,
      material(roofColor || 0x40545a, { roughness: .92, flatShading: true }),
      0, height + .35 + roofHeight / 2, 0, true, true);
    addSnowRoof(g, roof, 1.02);
    addCylinder(g, .035, .035, .7, 4, M.goldDark,
      0, height + .35 + roofHeight + .25, 0, false, false);
    addMesh(g, new THREE.SphereGeometry(.1, 6, 5), M.gold,
      0, height + .35 + roofHeight + .62, 0, false, false);

    for (let i = 0; i < 2; i++) {
      const a = [.3, .96][i];
      addGreatWindow(g, Math.sin(a) * radius * .95, height * (.37 + i * .22),
        Math.cos(a) * radius * .95, a, .52);
    }
    addWindow(g, Math.sin(-.42) * radius * .94, height * .58,
      Math.cos(-.42) * radius * .94, -.42, .8);

    if (opts.clock) {
      const clock = new THREE.Group();
      clock.position.set(0, height * .74, radius * 1.0);
      const face = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .06, 16),
        material(0xeee3ca));
      face.rotation.x = Math.PI / 2;
      clock.add(face);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.35, .035, 4, 16), M.gold);
      ring.position.z = .04;
      clock.add(ring);
      const h1 = new THREE.Mesh(new THREE.BoxGeometry(.035, .22, .025), M.ink);
      h1.position.set(0, .08, .07);
      const h2 = new THREE.Mesh(new THREE.BoxGeometry(.18, .03, .025), M.ink);
      h2.position.set(.06, 0, .07);
      h2.rotation.z = -.3;
      clock.add(h1, h2);
      g.add(clock);
    }

    if (opts.flag) {
      const flag = makeFlyingFlag(.9, .48, makeFlagTexture(HOUSE[opts.flag]), .15, opts.phase || 0);
      flag.position.set(0, height + .35 + roofHeight + .65, 0);
      flag.rotation.y = -.3;
      g.add(flag);
    }
    return g;
  }

  const backTowers = [
    [-8.8, -17.6, .78, 5.1, 1.7, 0x40555b, { flag: 'ravenclaw', phase: 1.1 }],
    [-5.1, -19.2, .62, 6.0, 1.8, 0x3d5258, {}],
    [1.2, -19.5, .66, 6.4, 1.9, 0x3b5056, {}],
    [4.8, -18.2, 1.02, 8.9, 2.3, 0x33494f, { flag: 'gryffindor', phase: 2.4, clock: true }],
    [9.8, -17.2, .8, 5.5, 1.7, 0x45595c, { flag: 'slytherin', phase: .4 }],
    [-12.6, -15.9, .67, 4.0, 1.35, 0x4a5c5f, { flag: 'hufflepuff', phase: 1.8 }],
    [13.1, -16.2, .7, 4.4, 1.5, 0x405459, {}]
  ];
  for (const [x, z, r, h, rh, col, opts] of backTowers) {
    backdropTower(x, z, r, h, rh, col, opts);
  }

  // Low pines frame the castle without stealing the pitch's silhouette.
  function backdropPine(x, z, height, tint) {
    const g = new THREE.Group();
    g.position.set(x, 1.84, z);
    grounds.add(g);
    addCylinder(g, .07, .1, height * .35, 5, M.woodDark, 0, height * .17, 0, false, false);
    const tiers = 3;
    for (let i = 0; i < tiers; i++) {
      const r = height * (.19 - i * .035);
      const h = height * (.36 - i * .045);
      const cone = addCone(g, r, h, 6, tint || bdPine, 0, height * (.24 + i * .19), 0, true, false);
      addSnowRoof(g, cone, 1.02);
    }
    g.scale.setScalar(1);
    return g;
  }
  const pineSpots = [
    [-15.0, -14.0, 2.8, bdPineDark], [-14.6, -16.4, 3.7, bdPine],
    [-13.7, -13.2, 2.2, bdPine], [-15.2, -17.8, 3.2, bdPineDark],
    [-15.4, -12.8, 2.1, bdPine], [-14.2, -18.6, 2.7, bdPineDark],
    [14.2, -14.7, 2.9, bdPineDark], [13.6, -17.2, 3.5, bdPine],
    [13.0, -18.2, 2.4, bdPine], [12.2, -19.0, 1.9, bdPineDark],
    [14.6, -12.7, 2.4, bdPine], [14.9, -15.6, 3.1, bdPineDark],
    [13.2, -17.0, 2.1, bdPine], [12.2, -13.4, 1.7, bdPineDark],
    // Foreground trees on the cliff edges frame the castle and hide the
    // plateau's cut edge from the camera.
    [11.7, -11.9, 4.1, bdPineDark], [13.2, -12.3, 5.2, bdPine],
    [14.8, -13.0, 4.7, bdPineDark], [-12.0, -11.8, 3.8, bdPineDark],
    [-13.7, -12.4, 4.8, bdPine], [-15.2, -13.2, 4.0, bdPineDark]
  ];
  for (const [x, z, h, tint] of pineSpots) backdropPine(x, z, h, tint);

  // Rough cliff faces break up the smooth edge of the plateau.
  const cliffRocks = [
    [13.8, -14.2, 1.7, 1.0, 1.15], [15.0, -16.3, 1.4, .85, 1.0],
    [12.7, -17.5, 1.2, .7, .9], [14.8, -18.4, 1.0, .6, .8],
    [-14.7, -15.4, 1.5, .85, 1.1], [-15.2, -17.6, 1.2, .7, .9],
    [10.8, -11.9, 1.1, .65, .8], [-11.3, -11.8, 1.0, .6, .8]
  ];
  for (const [x, z, sx, sy, sz] of cliffRocks) {
    const rock = addMesh(grounds, new THREE.DodecahedronGeometry(1, 0),
      material(0x84745e, { roughness: 1, flatShading: true }),
      x, .25, z, true, true);
    rock.scale.set(sx, sy, sz);
    rock.rotation.set(rr(-.3, .3), rr(0, 6.28), rr(-.2, .2));
  }

  // A short crenellated curtain wall on each side of the Great Hall.
  (function addBackCurtainWall() {
    for (const [cx, w] of [[-10.7, 6.2], [7.1, 4.2]]) {
      addBox(grounds, w, 3.0, .55, bdStone,
        cx, 1.84 + 1.5, -15.7, true, true);
      const count = Math.max(3, Math.round(w / 1.15));
      for (let i = 0; i <= count; i++) {
        addBox(grounds, .42, .36, .68, bdStoneLight,
          cx - w / 2 + i * (w / count), 1.84 + 3.1, -15.7, true, true);
      }
      for (let i = 0; i < 3; i++) {
        addBox(grounds, .12, .26, .05, M.windowGlow,
          cx - w * .3 + i * w * .3, 1.84 + 1.65, -15.4, false, false);
      }
    }
  })();

  // Pale mist bands settle around the castle foot.
  function makeMistTexture() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 128);
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(240,239,232,0)');
    grad.addColorStop(.38, 'rgba(232,231,223,.28)');
    grad.addColorStop(.72, 'rgba(226,226,219,.42)');
    grad.addColorStop(1, 'rgba(232,232,225,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 256;
      const y = 40 + Math.random() * 65;
      const r = 14 + Math.random() * 35;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(245,244,237,.14)');
      rg.addColorStop(1, 'rgba(245,244,237,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const mistTexture = makeMistTexture();
  const backdropMistSprites = [];
  for (const [x, y, z, sx, sy, op] of [
    [0, 4.1, -21.8, 37, 9, .22],
    [0, 1.8, -15.9, 29, 4.4, .16],
    [7, 3.2, -20.4, 18, 5.2, .13],
    [12.5, 2.4, -16.8, 14, 4.6, .21],
    [-13.5, 2.6, -15.4, 12, 4.2, .14]
  ]) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mistTexture,
      color: 0xf3f0e7,
      transparent: true,
      opacity: op,
      depthWrite: false
    }));
    sprite.position.set(x, y, z);
    sprite.scale.set(sx, sy, 1);
    sprite.visible = !embedded;
    grounds.add(sprite);
    backdropMistSprites.push({ sprite, baseOpacity: op });
  }

  // A handful of floating candles along the far stand.
  const floatingCandles = [];
  (function addFloatingCandles() {
    const glowTexture = (() => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext('2d');
      const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
      gr.addColorStop(0, 'rgba(255,245,203,.96)');
      gr.addColorStop(.35, 'rgba(255,201,104,.45)');
      gr.addColorStop(1, 'rgba(255,189,82,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    })();
    const candleMat = material(0xf4e8ca, { roughness: 1 });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const baseX = -7.6 + i * 2.9;
      g.position.set(baseX, 4.1 + (i % 2) * .35, -11.1);
      addCylinder(g, .035, .045, .22, 5, candleMat, 0, 0, 0, false, false);
      addCone(g, .045, .13, 5, material(0xffd477, { roughness: 1, emissive: 0xff9f31, emissiveIntensity: .9 }), 0, .17, 0, false, false);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffd98a,
        transparent: true,
        opacity: .42,
        depthWrite: false
      }));
      glow.scale.setScalar(.62);
      g.add(glow);
      grounds.add(g);
      floatingCandles.push({ group: g, baseY: g.position.y, phase: i * 1.35, glow });
    }
  })();

  // Two distant birds keep the white airspace alive.
  const backdropBirds = [];
  (function addBackdropBirds() {
    const birdMat = material(0x5a5245, { roughness: 1 });
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      addMesh(g, new THREE.SphereGeometry(.09, 5, 4), birdMat, 0, 0, 0, false, false);
      const wingL = addBox(g, .52, .035, .11, birdMat, -.28, .03, 0, false, false);
      const wingR = addBox(g, .52, .035, .11, birdMat, .28, .03, 0, false, false);
      g.scale.setScalar(.9 + i * .18);
      grounds.add(g);
      backdropBirds.push({ group: g, wingL, wingR, phase: i * .46, speed: .015 + i * .004 });
    }
  })();

  function updateBackdropLife(t, dt) {
    for (const c of floatingCandles) {
      c.group.position.y = c.baseY + Math.sin(t * .9 + c.phase) * .13;
      c.group.rotation.y += dt * .18;
      c.glow.material.opacity = .38 + Math.sin(t * 2.7 + c.phase) * .07;
    }
    for (const b of backdropBirds) {
      const a = (t * b.speed + b.phase) % 1;
      const x = -17 + a * 34;
      const z = -13.4 - Math.sin(a * Math.PI * 2) * 1.1;
      b.group.position.set(x, 8.6 + Math.sin(t * .45 + b.phase * 5) * .65, z);
      b.group.rotation.y = Math.PI * .5;
      const flap = Math.sin(t * 7.5 + b.phase * 9) * .45;
      b.wingL.rotation.z = flap;
      b.wingR.rotation.z = -flap;
    }
  }

  // Bunting between the far corner towers and the castle. The pennants follow
  // the actual catenary now, so they read as festive flags instead of a stray wire.
  (function addBunting() {
    const colors = [0x8b2634, 0xd6ae58, 0x245b47, 0xb6c5b2, 0x2d4674, 0xb89355, 0xc69a28, 0x2e2a22];
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-16.4, 5.4, -10.42),
      new THREE.Vector3(-9.2, 4.62, -10.9),
      new THREE.Vector3(-1.25, 4.48, -11.25),
      new THREE.Vector3(7.9, 4.72, -10.95),
      new THREE.Vector3(16.4, 5.55, -10.42)
    ]);
    const linePts = curve.getPoints(70);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
      color: 0x806847, transparent: true, opacity: .52
    }));
    world.add(line);

    const shape = new THREE.Shape();
    shape.moveTo(-.145, 0);
    shape.lineTo(.145, 0);
    shape.lineTo(0, -.42);
    shape.closePath();
    const triGeo = new THREE.ShapeGeometry(shape);
    for (let i = 0; i < 38; i++) {
      const u = (i + .5) / 38;
      const p = curve.getPointAt(u);
      const mat = new THREE.MeshStandardMaterial({
        color: colors[i % colors.length], roughness: 1, side: THREE.DoubleSide, flatShading: true
      });
      const f = new THREE.Mesh(triGeo, mat);
      f.position.set(p.x, p.y - .035, p.z + .015);
      f.rotation.x = -.03;
      f.castShadow = false;
      world.add(f);
    }
  })();

  // Soft snow banks around the diorama's walkways and corners.
  (function addSnowBanks() {
    const geo = new THREE.SphereGeometry(.5, 6, 4);
    const spots = [
      [-17.0, 11.75, 1.5], [-14.8, 11.9, 1.1], [15.0, 11.9, 1.3], [17.1, 11.8, 1.5],
      [-17.0, -11.8, 1.2], [-14.6, 11.2, .8], [17.0, -11.9, 1.35],
      [-13.9, 8.35, .75], [13.8, 8.35, .9], [-0.4, 8.4, .7], [6.9, 8.4, .8],
      [-13.85, -8.35, .7], [13.8, -8.35, .8], [-3.2, -8.42, .65], [7.6, -8.4, .75],
      [-15.7, 3.8, .9], [15.7, -3.4, 1.0]
    ];
    for (const [x, z, s] of spots) {
      const m = new THREE.Mesh(geo, snowMat);
      m.position.set(x, 0.08, z);
      m.scale.set(s, .22 + s * .06, s * .6);
      m.rotation.y = rr(0, Math.PI);
      m.castShadow = true;
      m.receiveShadow = true;
      m.visible = false;
      world.add(m);
      snowOverlays.push(m);
    }
  })();

  /* -----------------------------------------------------------------------
     Quidditch hoops
     ----------------------------------------------------------------------- */
  function buildGoal(sign) {
    const g = new THREE.Group();
    const zs = [-3.35, 0, 3.35];
    const heights = [4.42, 5.58, 4.78];
    const radii = [.7, .7, .7];
    for (let i = 0; i < 3; i++) {
      const z = zs[i];
      const ringY = heights[i];
      const poleX = sign * 15.05;
      const ringX = sign * 14.18;
      const poleH = ringY + .55;
      addCylinder(g, .075, .115, poleH, 7, M.woodDark, poleX, poleH / 2 + .02, z, true, true);
      addCylinder(g, .16, .24, .28, 7, M.stoneShade, poleX, .16, z, true, true);
      addCylinder(g, .105, .105, .13, 7, M.gold, poleX, ringY - .38, z, false, false);
      addCylinder(g, .105, .105, .08, 7, M.gold, poleX, ringY + .28, z, false, false);
      addCone(g, .14, .38, 6, M.gold, poleX, poleH + .21, z, false, false);

      // The support arm runs between pole and ring.
      addBox(g, Math.abs(poleX - ringX), .075, .075, M.gold,
        (poleX + ringX) / 2, ringY, z, false, false);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radii[i], .112, 6, 22),
        M.goldBright
      );
      ring.position.set(ringX, ringY, z);
      ring.rotation.y = Math.PI / 2;
      ring.castShadow = true;
      ring.receiveShadow = true;
      g.add(ring);

      // A thin hanging ribbon at each ring, for a little wizarding pomp.
      if (i === 1) {
        for (let k = 0; k < 3; k++) {
          const ribbon = addBox(g, .035, .55, .035, material(k % 2 ? COL.gold : 0x7d2130),
            ringX + sign * .02, ringY - .74 - k * .015, z + .26, false, false);
          ribbon.rotation.z = rr(-.1, .1);
        }
      }
    }
    world.add(g);
  }
  buildGoal(-1);
  buildGoal(1);

  // Corner flag posts at field ends.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 14.1;
      const z = sz * 8.0;
      addCylinder(world, .028, .038, 2.2, 5, M.woodDark, x, 1.1, z, false, false);
      addMesh(world, new THREE.SphereGeometry(.065, 5, 4), M.gold, x, 2.25, z, false, false);
      const flag = makeFlyingFlag(.78, .4, makeFlagTexture(sx === sz ? HOUSE.gryffindor : HOUSE.slytherin), .15, sx + sz);
      flag.position.set(x, 2.14, z);
      flag.rotation.y = -.7 * sx;
      world.add(flag);
    }
  }

  /* -----------------------------------------------------------------------
     Riders and brooms
     ----------------------------------------------------------------------- */
  function makeRibbonGeometry(length, width, segments, taper) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const f = i / segments;
      const x = -f * length;
      const w = width * (1 - f * (1 - taper)) * .5;
      positions.push(x, 0, -w, x, 0, w);
      uvs.push(0, f, 1, f);
    }
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function createRider(config) {
    const root = new THREE.Group();
    const model = new THREE.Group();
    root.add(model);

    const robeMat = material(config.robe, { roughness: 1 });
    const robeDeep = material(config.robeDeep, { roughness: 1 });
    const accentMat = material(config.accent, { roughness: .85, metalness: .05 });
    const skinMat = material(config.skin, { roughness: 1 });
    const hairMat = material(config.hair, { roughness: 1 });
    const darkMat = material(0x2a231c, { roughness: 1 });
    const strawMat = material(config.straw || 0xb78a49, { roughness: 1 });
    const strawLight = material(0xd0a760, { roughness: 1 });

    // Broom shaft, tail and fittings.
    const broom = new THREE.Group();
    const shaft = addCylinder(broom, .048, .065, 2.45, 6, M.woodLight, .02, 0, 0, true, true);
    shaft.rotation.z = Math.PI / 2;
    const nose = addCone(broom, .085, .3, 6, M.gold, 1.32, 0, 0, true, false);
    nose.rotation.z = -Math.PI / 2;
    addCylinder(broom, .1, .1, .12, 7, M.goldDark, -1.08, 0, 0, false, false).rotation.z = Math.PI / 2;

    const tail = new THREE.Group();
    tail.position.set(-1.16, 0, 0);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      const len = .68 + (i % 3) * .13;
      const bristle = addCylinder(tail, .012, .09, len, 4, i % 2 ? strawMat : strawLight,
        -len / 2, Math.sin(a) * .055, Math.cos(a) * .055, true, false);
      bristle.rotation.z = Math.PI / 2;
      bristle.rotation.x = Math.sin(a) * .18;
      bristle.rotation.y = Math.cos(a) * .18;
    }
    broom.add(tail);

    addBox(broom, .24, .055, .34, darkMat, -.2, .055, 0, true, false);
    addBox(broom, .035, .2, .035, M.goldDark, -.08, -.12, -.18, false, false);
    addBox(broom, .035, .2, .035, M.goldDark, -.08, -.12, .18, false, false);
    broom.scale.x = .82;
    model.add(broom);

    // Legs tucked along the broom.
    const legMat = material(config.trousers || 0x33302b, { roughness: 1 });
    cylinderBetween(model, -.08, .37, .15, .22, .13, .18, .055, legMat, 5);
    cylinderBetween(model, .22, .13, .18, -.34, .10, .20, .05, legMat, 5);
    cylinderBetween(model, -.08, .37, -.15, .22, .13, -.18, .055, legMat, 5);
    cylinderBetween(model, .22, .13, -.18, -.34, .10, -.20, .05, legMat, 5);
    addBox(model, .19, .1, .11, darkMat, -.38, .09, .2, true, false);
    addBox(model, .19, .1, .11, darkMat, -.38, .09, -.2, true, false);

    // Robe skirt and torso, leaning into the wind.
    const skirt = addCylinder(model, .14, .26, .46, 6, robeMat, -.1, .48, 0, true, true);
    skirt.rotation.z = -.12;
    const torso = new THREE.Group();
    torso.position.set(-.01, .73, 0);
    torso.rotation.z = -.32;
    addBox(torso, .25, .44, .32, robeMat, 0, 0, 0, true, true);
    addBox(torso, .255, .07, .325, accentMat, 0, -.17, 0, false, true);
    addBox(torso, .06, .06, .075, accentMat, .13, .04, .12, false, false); // tiny house badge
    model.add(torso);

    // Scarf: a wrapped band plus individual trailing stripes.
    const scarfSegments = [];
    if (config.scarf) {
      addCylinder(model, .155, .165, .09, 7, accentMat, .13, .93, 0, false, false).rotation.z = -.28;
      for (let i = 0; i < 7; i++) {
        const segMat = material(i % 2 ? config.scarfAccent : config.scarfMain, { roughness: 1 });
        const seg = addBox(model, .115, .035, .14, segMat, 0, 0, 0, true, false);
        scarfSegments.push(seg);
      }
    }

    // Arms. Long sleeves keep the silhouette graphic; leather gloves stop the
    // reaching arms from turning into bright blobs in the pixel pass.
    const shoulderY = .87;
    const gloveMat = material(0x4a3223, { roughness: 1 });
    const armSpecs = [
      { z: .19, reach: config.seeker ? .92 : .55, handY: config.seeker ? .72 : .52, glove: config.keeper },
      { z: -.19, reach: .55, handY: .52, glove: config.keeper }
    ];
    for (const arm of armSpecs) {
      const sh = new THREE.Vector3(.01, shoulderY, arm.z);
      const el = new THREE.Vector3(.28, .74, arm.z * 1.12);
      const hand = new THREE.Vector3(arm.reach, arm.handY, arm.z * .82);
      const wrist = el.clone().lerp(hand, .58);
      cylinderBetween(model, sh.x, sh.y, sh.z, el.x, el.y, el.z, .052, robeMat, 5);
      cylinderBetween(model, el.x, el.y, el.z, wrist.x, wrist.y, wrist.z, .045, robeMat, 5);
      addBox(model, .085, .07, .085, accentMat, wrist.x, wrist.y, wrist.z, false, false);
      cylinderBetween(model, wrist.x, wrist.y, wrist.z, hand.x, hand.y, hand.z, .032, skinMat, 5);
      const handMesh = addBox(model, arm.glove ? .16 : .078, arm.glove ? .14 : .07, arm.glove ? .14 : .08,
        config.keeper ? accentMat : gloveMat, hand.x, hand.y, hand.z, true, false);
      handMesh.rotation.z = .18;
    }

    // Head and hair.
    const head = new THREE.Group();
    head.position.set(.22, 1.03, 0);
    addSphereHead(head, skinMat);
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(.158, 8, 5, 0, Math.PI * 2, 0, Math.PI * .62),
      hairMat
    );
    hairCap.position.set(-.012, .022, 0);
    hairCap.castShadow = true;
    head.add(hairCap);
    addBox(head, .09, .055, .13, hairMat, .10, .08, .11, false, false);
    addBox(head, .09, .055, .13, hairMat, .10, .08, -.11, false, false);
    // Nose, eyes and a tiny highlight.
    addBox(head, .055, .045, .042, skinMat, .155, -.016, 0, false, false);
    addBox(head, .022, .028, .018, M.ink, .147, .045, .055, false, false);
    addBox(head, .022, .028, .018, M.ink, .147, .045, -.055, false, false);
    addBox(head, .025, .012, .048, material(0x9a5f4d, { roughness: 1 }), .15, -.06, 0, false, false);
    if (config.glasses) {
      const lensGeo = new THREE.TorusGeometry(.062, .009, 4, 10);
      const lensMat = material(0x1b1712, { roughness: .55, metalness: .1 });
      for (const zz of [-.058, .058]) {
        const lens = new THREE.Mesh(lensGeo, lensMat);
        lens.position.set(.157, .046, zz);
        lens.rotation.y = Math.PI / 2;
        head.add(lens);
      }
      addBox(head, .012, .012, .055, lensMat, .157, .048, 0, false, false);
      addBox(head, .01, .01, .05, lensMat, .157, .048, .119, false, false);
      addBox(head, .01, .01, .05, lensMat, .157, .048, -.119, false, false);
    }
    // Lightning-scar suggestion, one tiny warm mark.
    if (config.seeker) {
      addBox(head, .016, .055, .016, material(0xd99681), .153, .12, -.045, false, false)
        .rotation.z = .45;
    }
    model.add(head);

    // A segmented cape that streams back, plus two narrow robe tails.
    const capeGeo = makeRibbonGeometry(config.capeLength || 1.0, .38, 8, .62);
    const capeBase = Float32Array.from(capeGeo.attributes.position.array);
    const capeMat = new THREE.MeshStandardMaterial({
      color: config.robe, roughness: 1, side: THREE.DoubleSide, flatShading: true
    });
    const cape = new THREE.Mesh(capeGeo, capeMat);
    cape.position.set(-.09, .89, 0);
    cape.castShadow = true;
    cape.receiveShadow = true;
    cape.userData.base = capeBase;
    cape.userData.kind = 'cape';
    model.add(cape);

    const tails = [];
    for (const side of [-1, 1]) {
      const geo = makeRibbonGeometry((config.capeLength || 1) * .72, .14, 6, .38);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: side < 0 ? config.robeDeep : config.robe,
        roughness: 1, side: THREE.DoubleSide, flatShading: true
      }));
      mesh.position.set(-.16, .62, side * .16);
      mesh.userData.base = Float32Array.from(geo.attributes.position.array);
      mesh.userData.kind = 'tail';
      mesh.castShadow = true;
      model.add(mesh);
      tails.push(mesh);
    }
    const capeTip = addBox(model, .16, .025, .2, accentMat, -.9, .83, 0, false, false);

    // Quaffle tucked under the chaser's arm.
    let quaffle = null;
    if (config.chaser) {
      quaffle = new THREE.Group();
      quaffle.position.set(.26, .6, .34);
      quaffle.rotation.z = .2;
      addMesh(quaffle, new THREE.SphereGeometry(.165, 8, 6), material(0x8c3b2f, { roughness: .86 }),
        0, 0, 0, true, true);
      const seamMat = material(0xd2ab67, { roughness: .8 });
      addMesh(quaffle, new THREE.TorusGeometry(.165, .013, 3, 12), seamMat, 0, 0, 0, false, false)
        .rotation.x = Math.PI / 2;
      addMesh(quaffle, new THREE.TorusGeometry(.165, .013, 3, 12), seamMat, 0, 0, 0, false, false)
        .rotation.y = Math.PI / 2;
      model.add(quaffle);
    }

    model.scale.setScalar(config.scale || 1.0);
    root.userData = {
      model, cape, tails, scarfSegments, capeTip, quaffle,
      phase: config.phase || 0,
      snow: 0
    };
    return root;
  }

  function addSphereHead(parent, mat) {
    const head = new THREE.Mesh(new THREE.SphereGeometry(.148, 8, 6), mat);
    head.castShadow = true;
    head.receiveShadow = true;
    parent.add(head);
    return head;
  }

  function animateRiderCloth(rider, t, speedFactor) {
    const ud = rider.userData;
    const cape = ud.cape;
    if (cape) {
      const pos = cape.geometry.attributes.position;
      const arr = pos.array;
      const base = cape.userData.base;
      const len = 1;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const z = base[i * 3 + 2];
        const f = clamp(-x / 1.0, 0, 1);
        arr[i * 3 + 1] = Math.sin(t * 4.8 + f * 6.0 + ud.phase) * .09 * f
          + Math.sin(t * 2.4 + z * 9.0 + ud.phase) * .028 * f
          + f * f * .03;
        arr[i * 3 + 2] = z + Math.sin(t * 3.7 + f * 4.2 + ud.phase) * .055 * f;
      }
      pos.needsUpdate = true;
      cape.geometry.computeVertexNormals();
    }
    for (const tail of ud.tails) {
      const pos = tail.geometry.attributes.position;
      const arr = pos.array;
      const base = tail.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const z = base[i * 3 + 2];
        const f = clamp(-x / .72, 0, 1);
        arr[i * 3 + 1] = Math.sin(t * 5.2 + f * 5 + ud.phase + 1.1) * .1 * f * f
          + f * f * .05;
        arr[i * 3 + 2] = z + Math.sin(t * 4 + f * 4 + ud.phase) * .035 * f;
      }
      pos.needsUpdate = true;
      tail.geometry.computeVertexNormals();
    }
    if (ud.scarfSegments.length) {
      let px = .02;
      let py = .98;
      for (let i = 0; i < ud.scarfSegments.length; i++) {
        const seg = ud.scarfSegments[i];
        const f = i / ud.scarfSegments.length;
        seg.position.set(
          px - i * .125,
          py - i * .012 + Math.sin(t * 4.4 + i * .9 + ud.phase) * .025 * (0.3 + f),
          Math.sin(t * 3.4 + i * .72 + ud.phase) * .075 * f
        );
        seg.rotation.z = .38 + Math.sin(t * 3.7 + i + ud.phase) * .09;
        seg.rotation.y = Math.sin(t * 2.6 + i * .4) * .1 * f;
        seg.rotation.x = Math.cos(t * 3.1 + i) * .1 * f;
      }
    }
    if (ud.capeTip) {
      ud.capeTip.position.set(-.9 + Math.sin(t * 4.8 + ud.phase) * .02, .84 + Math.sin(t * 4.8) * .04, 0);
    }
  }

  // ---------------------------------------------------------------------
  // Formation riders. A full Quidditch side is seven players; the two named
  // seekers and the two goalkeepers are the detailed hero models, while the
  // supporting chasers and beaters use this efficient silhouette model.
  // ---------------------------------------------------------------------
  const formationRiders = [];

  function createFormationRider(houseKey, role, config) {
    const house = HOUSE[houseKey];
    const root = new THREE.Group();
    const model = new THREE.Group();
    root.add(model);

    const robeMat = material(house.main, { roughness: 1 });
    const robeDeep = material(house.deep, { roughness: 1 });
    const accentMat = material(house.light, { roughness: .9 });
    const skinMat = material(house.skin, { roughness: 1 });
    const hairMat = material(config.hair || 0x2b211b, { roughness: 1 });
    const trousers = material(0x2d2b27, { roughness: 1 });
    const straw = material(config.straw || 0xb68a49, { roughness: 1 });

    // Broom.
    const broom = new THREE.Group();
    const shaft = addCylinder(broom, .043, .06, 2.15, 5, M.woodLight, 0, 0, 0, true, true);
    shaft.rotation.z = Math.PI / 2;
    const nose = addCone(broom, .075, .26, 5, M.gold, 1.14, 0, 0, true, false);
    nose.rotation.z = -Math.PI / 2;
    addCylinder(broom, .085, .085, .1, 6, M.goldDark, -.93, 0, 0, false, false)
      .rotation.z = Math.PI / 2;
    const tail = addCone(broom, .18, .82, 5, straw, -1.22, 0, 0, true, false);
    tail.rotation.z = Math.PI / 2;
    addBox(broom, .2, .05, .3, M.woodDark, -.15, .055, 0, false, false);
    broom.scale.x = .85;
    model.add(broom);

    addBox(model, .48, .07, .11, trousers, -.22, .12, 0, true, false);
    addBox(model, .065, .07, .065, M.goldDark, -.35, .1, .17, false, false);
    addBox(model, .065, .07, .065, M.goldDark, -.35, .1, -.17, false, false);

    // Simple, readable torso and head.
    const body = addCylinder(model, .12, .235, .56, 5, robeMat, -.05, .57, 0, true, true);
    body.rotation.z = -.22;
    addBox(model, .23, .07, .27, accentMat, -.05, .79, 0, false, true);
    const head = new THREE.Group();
    head.position.set(.2, .99, 0);
    addMesh(head, new THREE.SphereGeometry(.132, 7, 5), skinMat, 0, 0, 0, true, true);
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(.14, 7, 4, 0, Math.PI * 2, 0, Math.PI * .62),
      hairMat
    );
    hair.position.set(-.01, .018, 0);
    hair.castShadow = true;
    head.add(hair);
    addBox(head, .024, .026, .018, M.ink, .13, .03, .055, false, false);
    addBox(head, .024, .026, .018, M.ink, .13, .03, -.055, false, false);
    model.add(head);

    // Arms and gloves.
    const handPositions = [];
    for (const side of [-1, 1]) {
      const hx = role === 'beater' && side > 0 ? .66 : .42;
      const hy = role === 'beater' && side > 0 ? .58 : .48;
      cylinderBetween(model, -.01, .79, side * .16, hx, hy, side * .14, .036, robeMat, 4);
      const hand = addBox(model, .065, .06, .065, role === 'keeper' ? accentMat : material(0x4a3223),
        hx, hy, side * .14, false, false);
      handPositions.push([hx, hy, side * .14]);
    }

    // A single trailing cape reads as motion at distance without the cost of
    // the hero's fully animated cloth.
    const capeGeo = makeRibbonGeometry(.78, .32, 6, .56);
    const capeMat = new THREE.MeshStandardMaterial({
      color: house.main, roughness: 1, side: THREE.DoubleSide, flatShading: true
    });
    const cape = new THREE.Mesh(capeGeo, capeMat);
    cape.position.set(-.08, .85, 0);
    cape.castShadow = true;
    cape.receiveShadow = true;
    model.add(cape);

    // Scarf tail.
    const scarf = addBox(model, .38, .03, .12, accentMat, -.38, .92, 0, true, false);
    scarf.rotation.z = .32;

    let bat = null;
    if (role === 'beater') {
      bat = new THREE.Group();
      const batHandle = addCylinder(bat, .035, .045, .85, 5, M.woodLight, .5, .77, .16, true, false);
      batHandle.rotation.z = -Math.PI / 2.65;
      addBox(bat, .22, .11, .12, M.woodDark, 1.0, 1.03, .16, true, false);
      model.add(bat);
    }
    if (role === 'keeper') {
      addBox(model, .15, .13, .14, accentMat, .42, .48, .18, true, false);
      addBox(model, .15, .13, .14, accentMat, .42, .48, -.18, true, false);
      addBox(model, .28, .1, .32, M.woodDark, -.02, .84, 0, true, false);
    }

    model.scale.setScalar(config.scale || 1);
    root.userData = {
      model, cape, scarf, bat, role, house,
      flight: null, bank: 0
    };
    return root;
  }

  function addFormationRider(houseKey, role, config, flight) {
    const rider = createFormationRider(houseKey, role, config);
    rider.userData.flight = flight;
    world.add(rider);
    formationRiders.push(rider);
    return rider;
  }

  function updateFormationRider(rider, t, dt) {
    const f = rider.userData.flight;
    let u = (f.phase + t * f.speed) % 1;
    if (u < 0) u += 1;
    f.curve.getPointAt(u, tempPoint);
    f.curve.getTangentAt(u, tempTangent).normalize();
    if (f.lateral) {
      tempSide.crossVectors(Y_AXIS, tempTangent).normalize();
      tempPoint.addScaledVector(tempSide, f.lateral);
    }
    tempPoint.y += (f.altitude || 0) + Math.sin(t * 2.6 + f.phase * 9.7) * .06;
    f.curve.getTangentAt((u + .004) % 1, tempNext).normalize();
    const yawNow = Math.atan2(-tempTangent.z, tempTangent.x);
    const yawNext = Math.atan2(-tempNext.z, tempNext.x);
    const turn = wrapAngle(yawNext - yawNow);
    const bank = -turn * 9.8 + Math.sin(t * .8 + f.phase * 8.5) * .035;
    orientRider(rider, tempPoint, tempTangent, bank, dt);
    const model = rider.userData.model;
    model.rotation.x = Math.sin(t * 2.0 + f.phase * 8.1) * .045;
    model.rotation.z = Math.sin(t * 1.4 + f.phase * 5.2) * .025;
    const cape = rider.userData.cape;
    cape.rotation.z = Math.sin(t * 4.6 + f.phase * 11.1) * .12;
    cape.rotation.x = Math.sin(t * 3.5 + f.phase * 7.3) * .1;
    const scarf = rider.userData.scarf;
    scarf.position.z = Math.sin(t * 4.2 + f.phase * 10.4) * .07;
    scarf.rotation.y = Math.sin(t * 3.3 + f.phase * 8.8) * .14;
    updateFormationSwing(rider, dt);
  }

  function updateFormationKeeper(rider, t, dt) {
    const z = Math.sin(t * 1.72 + 2.1) * 2.6 + Math.sin(t * 3.0) * .18;
    const y = 3.35 + Math.sin(t * 2.6 + 1.0) * .16;
    const x = -12.25 + Math.sin(t * 1.4 + 2.1) * .15;
    const pos = new THREE.Vector3(x, y, z);
    const velZ = Math.cos(t * 1.72 + 2.1) * 2.6 * 1.72;
    let diveLean = 0;
    if (keeperReaction.house === 'slytherin' && keeperReaction.weight > .001) {
      const w = keeperReaction.weight;
      pos.x += (keeperReaction.target.x - pos.x) * .72 * w;
      pos.y += (keeperReaction.target.y - pos.y) * .5 * w;
      pos.z += (keeperReaction.target.z - pos.z) * .8 * w;
      diveLean = w * .62;
    }
    const tangent = new THREE.Vector3(.18, .06, velZ).normalize();
    const bank = velZ * .18;
    orientRider(rider, pos, tangent, bank, dt, Math.PI * .07 + Math.sin(t * .55) * .08);
    const model = rider.userData.model;
    model.rotation.z = Math.sin(t * 1.8) * .03 + diveLean;
    const cape = rider.userData.cape;
    cape.rotation.z = Math.sin(t * 4.2 + .8) * .1;
    const scarf = rider.userData.scarf;
    scarf.position.z = Math.sin(t * 3.8) * .06;
  }

  const riders = [];

  function addRider(config, flight) {
    const rider = createRider(config);
    world.add(rider);
    rider.userData.flight = flight;
    rider.userData.bank = 0;
    rider.userData.bob = 0;
    riders.push(rider);
    return rider;
  }

  const heroCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-4.95, 4.12, 3.3),
    new THREE.Vector3(-1.55, 4.58, 2.8),
    new THREE.Vector3(2.55, 4.7, 1.65),
    new THREE.Vector3(4.75, 4.12, -.55),
    new THREE.Vector3(3.75, 3.58, -3.0),
    new THREE.Vector3(.7, 3.3, -3.95),
    new THREE.Vector3(-2.45, 3.38, -3.05),
    new THREE.Vector3(-4.65, 3.72, -.85),
    new THREE.Vector3(-5.35, 3.92, 1.35)
  ], true, 'centripetal', .5);
  // Nudge the duelling flight lane toward the visual centre of the pitch.
  for (const p of heroCurve.points) {
    p.x += 1.6;
    p.y -= .35;
    p.z -= .4;
  }
  heroCurve.updateArcLengths();

  // Malfoy flies a parallel line, shifted toward the camera-right so the two
  // seekers stay legible as separate silhouettes at every point in the loop.
  const rivalCurve = new THREE.CatmullRomCurve3(
    heroCurve.points.map(p => new THREE.Vector3(p.x - 1.85, p.y + .58, p.z + 1.2)),
    true, 'centripetal', .5
  );

  const chaserCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-9.1, 3.5, -1.0),
    new THREE.Vector3(-4.4, 4.15, -4.6),
    new THREE.Vector3(1.0, 4.55, -4.8),
    new THREE.Vector3(6.3, 4.15, -2.3),
    new THREE.Vector3(8.4, 3.85, 2.3),
    new THREE.Vector3(3.7, 3.9, 5.3),
    new THREE.Vector3(-2.4, 4.25, 4.75),
    new THREE.Vector3(-7.4, 3.8, 2.9)
  ], true, 'centripetal', .5);

  const hero = addRider({
    robe: 0x81232f, robeDeep: 0x5b1720, accent: 0xd6ae58, skin: 0xe7bd99,
    hair: 0x211a16, trousers: 0x342c25, straw: 0xb88944,
    scarf: true, scarfMain: 0x81232f, scarfAccent: 0xd6ae58,
    glasses: true, seeker: true, capeLength: 1.05, scale: 1.14, phase: 1.7
  }, {
    kind: 'hero', curve: heroCurve, speed: 1 / 3.4, offset: 0, lateral: 0,
    birdPhase: 1.2
  });

  const rival = addRider({
    robe: 0x225743, robeDeep: 0x173e2e, accent: 0xb7c6b1, skin: 0xe3c2a3,
    hair: 0xd8c58e, trousers: 0x2c312d, straw: 0x9d7b44,
    scarf: true, scarfMain: 0x225743, scarfAccent: 0xb7c6b1,
    glasses: false, seeker: false, capeLength: .98, scale: 1.07, phase: 3.9
  }, {
    kind: 'rival', curve: rivalCurve, speed: 1 / 3.7, offset: -.018, lateral: 0,
    verticalOffset: 0, birdPhase: 2.8
  });

  const keeper = addRider({
    robe: 0x7e2430, robeDeep: 0x591923, accent: 0xd8b05c, skin: 0xd6a37e,
    hair: 0x4a3024, trousers: 0x35302a, straw: 0xa98248,
    scarf: true, scarfMain: 0x7e2430, scarfAccent: 0xd8b05c,
    glasses: false, seeker: false, keeper: true, capeLength: .82, scale: 1.0, phase: .6
  }, { kind: 'keeper' });

  const chaser = addRider({
    robe: 0x245b47, robeDeep: 0x163e30, accent: 0xb6c5b2, skin: 0xd0a17d,
    hair: 0x31241a, trousers: 0x2a2d28, straw: 0xb1894e,
    scarf: true, scarfMain: 0x245b47, scarfAccent: 0xb6c5b2,
    glasses: false, seeker: false, chaser: true, capeLength: .9, scale: .95, phase: 2.1
  }, {
    kind: 'chaser', curve: chaserCurve, speed: 1 / 4.4, offset: .37, lateral: 0,
    verticalOffset: .7, birdPhase: 4.3
  });

  // The two full squads: seven a side.
  // Gryffindor: hero, keeper, three chasers and two beaters.
  // Slytherin: rival, keeper, three chasers and two beaters.
  const gChaserCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-10.4, 4.0, 3.4),
    new THREE.Vector3(-6.5, 4.45, 5.15),
    new THREE.Vector3(-1.0, 4.8, 5.4),
    new THREE.Vector3(4.8, 4.65, 4.25),
    new THREE.Vector3(9.2, 4.0, 1.0),
    new THREE.Vector3(8.35, 3.75, -3.0),
    new THREE.Vector3(3.6, 4.2, -5.15),
    new THREE.Vector3(-2.3, 4.5, -5.45),
    new THREE.Vector3(-7.9, 4.15, -3.25)
  ], true, 'centripetal', .5);

  const gBeaterCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-5.2, 5.7, 1.4),
    new THREE.Vector3(-1.8, 6.1, 3.15),
    new THREE.Vector3(2.6, 5.85, 2.55),
    new THREE.Vector3(5.25, 6.2, -.2),
    new THREE.Vector3(2.9, 6.45, -3.1),
    new THREE.Vector3(-1.8, 5.85, -3.35),
    new THREE.Vector3(-5.5, 5.6, -.8)
  ], true, 'centripetal', .5);

  const sBeaterCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(4.6, 5.0, -2.8),
    new THREE.Vector3(1.2, 5.5, -4.55),
    new THREE.Vector3(-3.6, 5.2, -4.0),
    new THREE.Vector3(-6.0, 5.55, -.4),
    new THREE.Vector3(-3.2, 5.8, 3.0),
    new THREE.Vector3(1.4, 5.15, 4.2),
    new THREE.Vector3(5.4, 4.9, 1.2)
  ], true, 'centripetal', .5);

  // Gryffindor chasers, strung out across the pitch.
  addFormationRider('gryffindor', 'chaser', { scale: 1.0, hair: 0x2a1e16 },
    { kind: 'formation', curve: gChaserCurve, phase: .08, speed: 1 / 3.9, altitude: .15, lateral: .18 });
  addFormationRider('gryffindor', 'chaser', { scale: .95, hair: 0x5a3a22 },
    { kind: 'formation', curve: gChaserCurve, phase: .41, speed: 1 / 4.25, altitude: .48, lateral: -.42 });
  addFormationRider('gryffindor', 'chaser', { scale: .98, hair: 0x1f1a16 },
    { kind: 'formation', curve: gChaserCurve, phase: .74, speed: 1 / 4.6, altitude: .22, lateral: .5 });

  // Slytherin's full-detail chaser is joined by two formation chasers.
  addFormationRider('slytherin', 'chaser', { scale: .97, hair: 0x2b211b },
    { kind: 'formation', curve: chaserCurve, phase: .06, speed: 1 / 4.1, altitude: .38, lateral: -.55 });
  addFormationRider('slytherin', 'chaser', { scale: .92, hair: 0xc9b47c },
    { kind: 'formation', curve: chaserCurve, phase: .69, speed: 1 / 4.5, altitude: .1, lateral: .42 });

  // Beaters hunt through the middle of the pitch with their bats raised.
  addFormationRider('gryffindor', 'beater', { scale: 1.0, hair: 0x33251c },
    { kind: 'formation', curve: gBeaterCurve, phase: .10, speed: 1 / 3.5, altitude: 0, lateral: .25 });
  addFormationRider('gryffindor', 'beater', { scale: .96, hair: 0x1e1814 },
    { kind: 'formation', curve: gBeaterCurve, phase: .58, speed: 1 / 3.9, altitude: .28, lateral: -.35 });
  addFormationRider('slytherin', 'beater', { scale: .98, hair: 0x241c15 },
    { kind: 'formation', curve: sBeaterCurve, phase: 0, speed: 1 / 3.7, altitude: .12, lateral: .3 });
  addFormationRider('slytherin', 'beater', { scale: .93, hair: 0x2f2117 },
    { kind: 'formation', curve: sBeaterCurve, phase: .51, speed: 1 / 4.15, altitude: .35, lateral: -.28 });

  // The Slytherin keeper guards the left-hand hoops.
  const slytherinKeeper = addFormationRider('slytherin', 'keeper', { scale: 1.0, hair: 0x2a2018 },
    { kind: 'keeper' });

  /* -----------------------------------------------------------------------
     The match: quaffle possession, passing, shots, saves and goal reactions
     ----------------------------------------------------------------------- */
  hero.userData.houseKey = 'gryffindor';
  rival.userData.houseKey = 'slytherin';
  keeper.userData.houseKey = 'gryffindor';
  chaser.userData.houseKey = 'slytherin';
  hero.userData.displayName = 'HARRY POTTER';
  rival.userData.displayName = 'DRACO MALFOY';
  keeper.userData.displayName = 'GRYFFINDOR KEEPER';
  chaser.userData.displayName = 'SLYTHERIN CHASER';

  const chasersByHouse = {
    gryffindor: formationRiders.filter(r => r.userData.role === 'chaser' && r.userData.house.key === 'gryffindor'),
    slytherin: [chaser, ...formationRiders.filter(r => r.userData.role === 'chaser' && r.userData.house.key === 'slytherin')]
  };
  const beatersByHouse = {
    gryffindor: formationRiders.filter(r => r.userData.role === 'beater' && r.userData.house.key === 'gryffindor'),
    slytherin: formationRiders.filter(r => r.userData.role === 'beater' && r.userData.house.key === 'slytherin')
  };
  const keepersByHouse = { gryffindor: keeper, slytherin: slytherinKeeper };

  // The static ball on the full-detail chaser is replaced by one live Quaffle.
  if (chaser.userData.quaffle) chaser.userData.quaffle.visible = false;

  const quaffleBall = new THREE.Group();
  addMesh(quaffleBall, new THREE.SphereGeometry(.18, 8, 6),
    material(0x8c3b2f, { roughness: .78 }), 0, 0, 0, true, true);
  const seamMat = material(0xd2ab67, { roughness: .72, metalness: .05 });
  addMesh(quaffleBall, new THREE.TorusGeometry(.181, .014, 3, 12), seamMat, 0, 0, 0, false, false)
    .rotation.x = Math.PI / 2;
  addMesh(quaffleBall, new THREE.TorusGeometry(.181, .014, 3, 12), seamMat, 0, 0, 0, false, false)
    .rotation.y = Math.PI / 2;
  const quaffleGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: 0xffd7a0,
    transparent: true,
    opacity: .42,
    depthWrite: false
  }));
  quaffleGlow.scale.setScalar(.58);
  quaffleBall.add(quaffleGlow);
  world.add(quaffleBall);

  const matchState = {
    phase: 'idle',
    timer: 6.5,
    time: 0,
    holder: chaser,
    receiver: null,
    team: 'slytherin',
    attackCount: 0,
    passFrom: new THREE.Vector3(),
    shotFrom: new THREE.Vector3(),
    shotTarget: new THREE.Vector3(),
    ballVel: new THREE.Vector3(),
    lastResult: '',
    willSave: false
  };
  const matchScore = {
    g: scoreGEl ? (parseInt(scoreGEl.textContent, 10) || 120) : 120,
    s: scoreSEl ? (parseInt(scoreSEl.textContent, 10) || 80) : 80
  };

  let keeperReaction = {
    house: '',
    target: new THREE.Vector3(),
    targetWeight: 0,
    weight: 0
  };
  let crowdExcitement = 0;
  let houseCheer = { key: '', time: 0 };
  let snitchBoost = 0;
  let snitchFlourishTime = 0;
  let snitchFlourishDuration = 0;
  let snitchFlourishActive = false;
  let beaterTimer = 4.5;
  let snitchEventTimer = 8;
  let highlightCooldown = 0;
  let quaffleTrailTimer = 0;

  const ballOffset = new THREE.Vector3(.32, .54, .24);
  const matchTempA = new THREE.Vector3();
  const matchTempB = new THREE.Vector3();

  function getHoldPoint(rider, out) {
    return out.copy(ballOffset).applyQuaternion(rider.quaternion).add(rider.position);
  }

  function teamName(team) {
    return team === 'gryffindor' ? 'Gryffindor' : 'Slytherin';
  }

  function pickChaser(team) {
    const list = chasersByHouse[team];
    return list[Math.floor(Math.random() * list.length)];
  }

  function setMatchStatus(text, hold) {
    showStatus(text, hold || 2.8);
  }

  function updateScoreUI(team, points) {
    matchScore[team] += points;
    const el = team === 'g' ? scoreGEl : scoreSEl;
    if (!el) return;
    el.textContent = String(matchScore[team]);
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  function beginAttack(forceTeam) {
    if (matchState.phase !== 'idle') return false;
    const holderTeam = matchState.holder.userData.houseKey ||
      (matchState.holder.userData.house && matchState.holder.userData.house.key);
    const team = forceTeam || holderTeam || 'slytherin';
    if (!chasersByHouse[team] || !chasersByHouse[team].length) return false;
    if (holderTeam !== team) matchState.holder = pickChaser(team);
    matchState.team = team;
    matchState.phase = 'hold';
    matchState.time = 0;
    matchState.attackCount++;
    quaffleBall.visible = true;
    setMatchStatus(teamName(team) + ' moves up the pitch', 2.4);
    return true;
  }

  function beginPass(t) {
    const team = matchState.team;
    const candidates = chasersByHouse[team].filter(r => r !== matchState.holder);
    const receiver = candidates[Math.floor(Math.random() * candidates.length)] || matchState.holder;
    matchState.receiver = receiver;
    matchState.passFrom.copy(quaffleBall.position);
    matchState.phase = 'pass';
    matchState.time = 0;
    AudioEngine.whoosh();
    setMatchStatus('A sharp pass across the pitch', 2.0);
  }

  function beginShot(t) {
    const team = matchState.team;
    const sign = team === 'gryffindor' ? -1 : 1;
    const zs = [-3.35, 0, 3.35];
    const ys = [4.42, 5.58, 4.78];
    const ringIndex = Math.floor(Math.random() * 3);
    const altIndex = (ringIndex + 1 + Math.floor(Math.random() * 2)) % 3;
    const willSave = (matchState.attackCount % 2) === 1;
    const defendTeam = team === 'gryffindor' ? 'slytherin' : 'gryffindor';
    matchState.willSave = willSave;
    matchState.shotFrom.copy(quaffleBall.position);
    matchState.shotTarget.set(sign * 14.18, ys[ringIndex], zs[ringIndex]);
    keeperReaction.house = defendTeam;
    keeperReaction.target.set(
      sign * 13.35,
      ys[willSave ? ringIndex : altIndex] - .25,
      zs[willSave ? ringIndex : altIndex]
    );
    keeperReaction.targetWeight = 1;
    matchState.phase = 'shot';
    matchState.time = 0;
    quaffleBall.visible = true;
    AudioEngine.whoosh();
    setMatchStatus(teamName(team) + ' shoots!', 2.2);
  }

  function resolveShot(t) {
    const team = matchState.team;
    const defendingTeam = team === 'gryffindor' ? 'slytherin' : 'gryffindor';
    keeperReaction.targetWeight = 0;
    matchState.phase = 'recover';
    matchState.time = 0;
    quaffleBall.visible = true;
    if (matchState.willSave) {
      matchState.lastResult = 'save';
      crowdExcitement = Math.max(crowdExcitement, 1.0);
      houseCheer.key = defendingTeam;
      houseCheer.time = Math.max(houseCheer.time, 1.4);
      AudioEngine.save();
      spawnGoalBurst(matchState.shotTarget, defendingTeam, false);
      matchState.ballVel.set(-Math.sign(matchState.shotTarget.x) * 2.2, 1.7, (Math.random() - .5) * 2.6);
      setMatchStatus('Saved by the ' + teamName(defendingTeam) + ' keeper!', 3.2);
    } else {
      matchState.lastResult = 'goal';
      updateScoreUI(team === 'gryffindor' ? 'g' : 's', 10);
      crowdExcitement = Math.max(crowdExcitement, 1.6);
      houseCheer.key = team;
      houseCheer.time = Math.max(houseCheer.time, 2.0);
      AudioEngine.goal();
      tossCelebration(team, 30);
      spawnGoalBurst(matchState.shotTarget, team, true);
      matchState.ballVel.set(-Math.sign(matchState.shotTarget.x) * 1.4, .4, (Math.random() - .5) * 1.8);
      setMatchStatus('GOAL! ' + teamName(team) + ' scores!', 4.0);
    }
    matchState.phase = 'recover';
    matchState.recoveryFor = defendingTeam;
  }

  function startNextAttack() {
    if (matchState.phase !== 'idle') return false;
    return beginAttack();
  }

  function requestHighlight() {
    if (highlightCooldown > 0) return;
    highlightCooldown = 1.2;
    if (matchState.phase === 'idle') {
      beginAttack();
      setMatchStatus('Match highlight: ' + teamName(matchState.team) + ' attack!', 3.0);
    } else {
      setMatchStatus('Match highlight: Potter dives!', 2.6);
    }
    triggerSnitchFlourish(true);
    triggerBeaterSwing();
  }

  function updateKeeperReaction(dt) {
    const speed = keeperReaction.targetWeight > 0 ? 5.4 : 3.8;
    keeperReaction.weight += (keeperReaction.targetWeight - keeperReaction.weight) *
      (1 - Math.exp(-dt * speed));
  }

  function updateMatch(t, dt) {
    updateKeeperReaction(dt);
    const step = Math.max(0, dt);
    if (matchState.phase === 'idle') {
      getHoldPoint(matchState.holder, quaffleBall.position);
      matchState.timer -= step;
      if (matchState.timer <= 0 && step > 0) {
        beginAttack();
      }
    } else if (matchState.phase === 'hold') {
      getHoldPoint(matchState.holder, quaffleBall.position);
      matchState.time += step;
      if (matchState.time > .95) beginPass(t);
    } else if (matchState.phase === 'pass') {
      matchState.time += step;
      const p = clamp(matchState.time / 1.0, 0, 1);
      getHoldPoint(matchState.receiver, matchTempB);
      quaffleBall.position.copy(matchState.passFrom).lerp(matchTempB, p);
      quaffleBall.position.y += Math.sin(p * Math.PI) * .9;
      if (p >= 1) {
        matchState.holder = matchState.receiver;
        matchState.phase = 'hold2';
        matchState.time = 0;
      }
    } else if (matchState.phase === 'hold2') {
      getHoldPoint(matchState.holder, quaffleBall.position);
      matchState.time += step;
      if (matchState.time > .7) beginShot(t);
    } else if (matchState.phase === 'shot') {
      matchState.time += step;
      const p = clamp(matchState.time / .95, 0, 1);
      quaffleBall.position.copy(matchState.shotFrom).lerp(matchState.shotTarget, p);
      quaffleBall.position.y += Math.sin(p * Math.PI) * .5;
      if (p >= 1) resolveShot(t);
    } else if (matchState.phase === 'recover') {
      matchState.time += step;
      quaffleBall.position.addScaledVector(matchState.ballVel, step);
      matchState.ballVel.y -= 5.5 * step;
      if (matchState.time > 1.15) {
        const nextTeam = matchState.recoveryFor;
        matchState.holder = pickChaser(nextTeam);
        matchState.phase = 'idle';
        matchState.timer = 10.5 + Math.random() * 4.5;
        quaffleBall.visible = true;
        getHoldPoint(matchState.holder, quaffleBall.position);
      }
    }
    if (matchState.phase === 'pass' || matchState.phase === 'shot' || matchState.phase === 'recover') {
      quaffleBall.rotation.x += step * 8;
      quaffleBall.rotation.z += step * 4.5;
      if (matchState.phase !== 'recover') {
        quaffleTrailTimer -= step;
        if (quaffleTrailTimer <= 0) {
          spawnSparks(quaffleBall.position, 'gold', 1, .2);
          quaffleTrailTimer = .055;
        }
      }
    }
    if (highlightCooldown > 0) highlightCooldown = Math.max(0, highlightCooldown - step);
    if (crowdExcitement > 0) crowdExcitement = Math.max(0, crowdExcitement - step * .45);
    if (houseCheer.time > 0) houseCheer.time = Math.max(0, houseCheer.time - step);
    if (snitchBoost > 0) snitchBoost = Math.max(0, snitchBoost - step);
    if (snitchFlourishTime > 0) snitchFlourishTime = Math.max(0, snitchFlourishTime - step);
    if (snitchFlourishTime <= 0) snitchFlourishActive = false;
    if (beaterTimer > 0) {
      beaterTimer -= step;
      if (beaterTimer <= 0) {
        triggerBeaterSwing();
        beaterTimer = 6.5 + Math.random() * 4;
      }
    }
    if (snitchEventTimer > 0) {
      snitchEventTimer -= step;
      if (snitchEventTimer <= 0) {
        triggerSnitchFlourish(false);
        snitchEventTimer = 10 + Math.random() * 5;
      }
    }
  }

  function triggerSnitchFlourish(byUser) {
    if (snitchFlourishTime > 0) return;
    snitchFlourishTime = 2.4;
    snitchFlourishDuration = 2.4;
    snitchFlourishActive = true;
    snitchBoost = Math.max(snitchBoost, 1.2);
    AudioEngine.chime();
    if (byUser) setMatchStatus('The Snitch flares gold!', 1.8);
    else setMatchStatus('Potter dives — the Snitch slips away!', 2.6);
  }

  function triggerBeaterSwing() {
    const houses = ['gryffindor', 'slytherin'];
    const house = houses[Math.floor(Math.random() * houses.length)];
    const list = beatersByHouse[house];
    if (!list || !list.length) return;
    const beater = list[Math.floor(Math.random() * list.length)];
    if (beater.userData.swing > 0) return;
    beater.userData.swing = .72;
    beater.userData.swingCooldown = 3.5;
    AudioEngine.whoosh();
    spawnSwingFlash(beater);

    // Launch a Bludger from the swinging bat and send it skimming past a rider.
    if (typeof bludgers !== 'undefined' && bludgers.length) {
      const targetPool = [hero, rival, chaser, keeper];
      const target = targetPool[Math.floor(Math.random() * targetPool.length)];
      const start = new THREE.Vector3(1.0, .9, .12)
        .applyQuaternion(beater.quaternion).add(beater.position);
      const targetPos = target.position.clone();
      const dir = targetPos.clone().sub(start);
      if (dir.lengthSq() > .01) dir.normalize();
      const end = targetPos.clone().addScaledVector(dir, 4.6).add(new THREE.Vector3(0, .8, 0));
      const mid = start.clone().lerp(end, .5).add(new THREE.Vector3(0, 1.5, 0));
      const ball = bludgers[Math.floor(Math.random() * bludgers.length)];
      ball.hiddenUntil = 0;
      ball.mesh.visible = true;
      bludgerEvent = { ball, start, mid, end, time: 0, duration: .92 };
    }
  }

  function updateScoreUIFromDOM() {
    if (scoreGEl) scoreGEl.textContent = String(matchScore.g);
    if (scoreSEl) scoreSEl.textContent = String(matchScore.s);
  }
  updateScoreUIFromDOM();
  getHoldPoint(matchState.holder, quaffleBall.position);

  // ---------------------------------------------------------------------
  // Shared spark bursts: goals, saves, bat hits, banner cheers and Snitch flares.
  // ---------------------------------------------------------------------
  const SPARK_COUNT = 128;
  const sparkMesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(.095, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    SPARK_COUNT
  );
  sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparkMesh.frustumCulled = false;
  sparkMesh.castShadow = false;
  world.add(sparkMesh);
  const sparkItems = [];
  const sparkDummy = new THREE.Object3D();
  const sparkPalette = {
    gold: [0xffe7a2, 0xf5c34f, 0xd59a2c, 0xfff4d2],
    gryffindor: [0x8b2634, 0xd6ae58, 0xffe1a0, 0xb92f40],
    slytherin: [0x245b47, 0xb6c5b2, 0xdaf3e6, 0x3d8f70],
    ravenclaw: [0x2d4674, 0xb89355, 0xd6e2f2, 0x4e6f9f],
    hufflepuff: [0xc69a28, 0x2e2a22, 0xffe08a, 0x9d7620],
    winter: [0xf7fcff, 0xbfdce9, 0xffffff],
    white: [0xffffff, 0xf6e5b0]
  };
  for (let i = 0; i < SPARK_COUNT; i++) {
    sparkItems.push({ active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, life: 0, spin: 0, scale: 0 });
    sparkDummy.position.set(0, -100, 0);
    sparkDummy.scale.setScalar(0);
    sparkDummy.updateMatrix();
    sparkMesh.setMatrixAt(i, sparkDummy.matrix);
    sparkMesh.setColorAt(i, new THREE.Color(0xffe7a2));
  }
  sparkMesh.instanceColor.needsUpdate = true;
  let sparkCursor = 0;

  function spawnSparks(pos, palette, count, power) {
    const colors = sparkPalette[palette] || sparkPalette.gold;
    for (let i = 0; i < count; i++) {
      const item = sparkItems[sparkCursor];
      sparkCursor = (sparkCursor + 1) % SPARK_COUNT;
      const angle = Math.random() * Math.PI * 2;
      const lift = Math.random() * Math.PI;
      const speed = (power || 1) * (1.2 + Math.random() * 2.8);
      item.active = true;
      item.pos.copy(pos).add(new THREE.Vector3(
        (Math.random() - .5) * .32,
        (Math.random() - .5) * .28,
        (Math.random() - .5) * .32
      ));
      item.vel.set(
        Math.cos(angle) * Math.sin(lift) * speed,
        Math.cos(lift) * speed * .72 + 1.2,
        Math.sin(angle) * Math.sin(lift) * speed
      );
      item.age = 0;
      item.life = .55 + Math.random() * .7;
      item.spin = (Math.random() - .5) * 9;
      item.scale = .6 + Math.random() * .8;
      sparkMesh.setColorAt(sparkCursor === 0 ? (SPARK_COUNT - 1) : (sparkCursor - 1),
        new THREE.Color(colors[Math.floor(Math.random() * colors.length)]));
    }
    sparkMesh.instanceColor.needsUpdate = true;
  }

  function updateSparks(dt) {
    for (let i = 0; i < SPARK_COUNT; i++) {
      const item = sparkItems[i];
      if (item.active) {
        item.age += dt;
        if (item.age >= item.life) {
          item.active = false;
          sparkDummy.position.set(0, -100, 0);
          sparkDummy.scale.setScalar(0);
        } else {
          item.vel.y -= 6.2 * dt;
          item.pos.addScaledVector(item.vel, dt);
          const life = 1 - item.age / item.life;
          sparkDummy.position.copy(item.pos);
          sparkDummy.rotation.set(item.age * item.spin, item.age * item.spin * .7, 0);
          sparkDummy.scale.setScalar(item.scale * (.35 + life * .8));
        }
      } else {
        sparkDummy.position.set(0, -100, 0);
        sparkDummy.scale.setScalar(0);
      }
      sparkDummy.updateMatrix();
      sparkMesh.setMatrixAt(i, sparkDummy.matrix);
    }
    sparkMesh.instanceMatrix.needsUpdate = true;
    if (goalFlashTime > 0) {
      goalFlashTime = Math.max(0, goalFlashTime - dt);
      goalLight.intensity = 4.4 * (goalFlashTime / .42);
    }
  }

  const goalLight = new THREE.PointLight(0xffd67a, 0, 9, 2);
  goalLight.position.set(0, 4, 0);
  world.add(goalLight);
  let goalFlashTime = 0;

  function spawnGoalBurst(pos, team, isGoal) {
    spawnSparks(pos, team === 'gryffindor' ? 'gryffindor' : 'slytherin',
      isGoal ? 34 : 12, isGoal ? 1.55 : .7);
    if (isGoal) {
      spawnSparks(pos, 'gold', 18, 1.3);
      goalLight.position.copy(pos);
      goalLight.intensity = 4.4;
      goalFlashTime = .42;
    }
  }

  function spawnSwingFlash(beater) {
    const p = new THREE.Vector3(1.0, .98, .16);
    beater.userData.model.localToWorld(p);
    spawnSparks(p, 'white', 8, .55);
  }

  function spawnSnitchBurst() {
    spawnSparks(snitch.position, 'gold', 18, 1.0);
  }

  // ---------------------------------------------------------------------
  // Bludgers: two iron balls weaving around the pitch. Beaters swing when
  // the beat falls due; the spark burst marks the hit.
  // ---------------------------------------------------------------------
  const bludgerCurves = [
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-8.6, 5.0, 4.7),
      new THREE.Vector3(-2.0, 5.8, 5.6),
      new THREE.Vector3(5.2, 5.15, 3.2),
      new THREE.Vector3(8.1, 4.7, -1.8),
      new THREE.Vector3(3.0, 5.4, -5.0),
      new THREE.Vector3(-4.8, 4.9, -4.6)
    ], true, 'centripetal', .5),
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(7.0, 4.5, -4.2),
      new THREE.Vector3(1.6, 4.95, -5.0),
      new THREE.Vector3(-5.8, 4.7, -2.8),
      new THREE.Vector3(-7.2, 5.35, 2.6),
      new THREE.Vector3(-1.1, 5.7, 4.9),
      new THREE.Vector3(5.8, 5.1, 2.8)
    ], true, 'centripetal', .5)
  ];
  let bludgerEvent = null;
  let bludgerEventTrail = 0;
  const bludgers = bludgerCurves.map((curve, i) => {
    const g = new THREE.Group();
    addMesh(g, new THREE.SphereGeometry(.17, 7, 5),
      material(0x282a28, { roughness: .38, metalness: .25 }), 0, 0, 0, true, false);
    addMesh(g, new THREE.TorusGeometry(.165, .014, 3, 10),
      material(0x6b6457, { roughness: .5, metalness: .25 }), 0, 0, 0, false, false)
      .rotation.x = Math.PI / 2;
    world.add(g);
    return { mesh: g, curve, u: i * .37 + .1, speed: .12 + i * .025 };
  });

  function updateBludgers(t, dt) {
    for (const b of bludgers) {
      b.u = (b.u + dt * b.speed) % 1;
      const p = b.curve.getPointAt(b.u);
      b.mesh.position.set(p.x, p.y + Math.sin(t * 2.6 + b.u * 5) * .12, p.z);
      b.mesh.rotation.x += dt * 4;
      b.mesh.rotation.y += dt * 6;
      if (b.hiddenUntil && t < b.hiddenUntil) b.mesh.visible = false;
      else b.mesh.visible = true;
    }
    if (bludgerEvent) {
      const e = bludgerEvent;
      e.time += dt;
      const q = clamp(e.time / e.duration, 0, 1);
      const inv = 1 - q;
      e.ball.mesh.position.set(
        inv * inv * e.start.x + 2 * inv * q * e.mid.x + q * q * e.end.x,
        inv * inv * e.start.y + 2 * inv * q * e.mid.y + q * q * e.end.y,
        inv * inv * e.start.z + 2 * inv * q * e.mid.z + q * q * e.end.z
      );
      e.ball.mesh.visible = true;
      e.ball.mesh.rotation.x += dt * 14;
      bludgerEventTrail -= dt;
      if (bludgerEventTrail <= 0) {
        spawnSparks(e.ball.mesh.position, 'white', 1, .16);
        bludgerEventTrail = .055;
      }
      if (q >= 1) {
        e.ball.hiddenUntil = t + .35;
        e.ball.mesh.visible = false;
        bludgerEvent = null;
      }
    }
  }

  function updateFormationSwing(rider, dt) {
    if (!rider.userData.bat) return;
    if (!rider.userData.swing) {
      rider.userData.bat.rotation.set(0, 0, 0);
      return;
    }
    rider.userData.swing = Math.max(0, rider.userData.swing - dt);
    const p = 1 - rider.userData.swing / .72;
    const swing = Math.sin(clamp(p, 0, 1) * Math.PI);
    rider.userData.bat.rotation.y = swing * 1.35;
    rider.userData.bat.rotation.z = swing * .25;
  }

  /* -----------------------------------------------------------------------
     The Golden Snitch and its trail
     ----------------------------------------------------------------------- */
  const snitch = new THREE.Group();
  const snitchBody = addMesh(snitch, new THREE.SphereGeometry(.135, 10, 8),
    material(0xd9a536, {
      metalness: .55, roughness: .28, emissive: 0x5d3b06, emissiveIntensity: .3
    }), 0, 0, 0, true, true);
  addMesh(snitch, new THREE.TorusGeometry(.14, .018, 4, 16),
    material(0xf0cf7c, { metalness: .45, roughness: .3 }), 0, 0, 0, false, false)
    .rotation.x = Math.PI / 2;
  addMesh(snitch, new THREE.TorusGeometry(.142, .011, 3, 16),
    material(0xf0cf7c, { metalness: .45, roughness: .3 }), 0, 0, 0, false, false)
    .rotation.z = Math.PI / 2;

  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.quadraticCurveTo(.18, .105, .43, .065);
  wingShape.quadraticCurveTo(.33, .02, .44, -.02);
  wingShape.quadraticCurveTo(.23, -.055, .13, -.085);
  wingShape.quadraticCurveTo(.06, -.07, 0, 0);
  const wingGeo = new THREE.ShapeGeometry(wingShape, 5);
  wingGeo.rotateX(-Math.PI / 2);
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0xfff4d4, roughness: .45, metalness: .06, side: THREE.DoubleSide,
    emissive: 0x3a2600, emissiveIntensity: .12, flatShading: true
  });
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  wingL.position.z = .08;
  wingL.castShadow = false;
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  wingR.position.z = -.08;
  wingR.rotation.y = Math.PI;
  wingR.scale.x = 1;
  wingR.castShadow = false;
  snitch.add(wingL, wingR);

  function makeGlowTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, 'rgba(255, 252, 226, 1)');
    g.addColorStop(.14, 'rgba(255, 224, 125, .92)');
    g.addColorStop(.44, 'rgba(244, 178, 55, .28)');
    g.addColorStop(1, 'rgba(238, 160, 35, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);

    // A soft four-pointed glint, so the tiny gold body reads at a glance.
    ctx.globalCompositeOperation = 'lighter';
    const ray = ctx.createLinearGradient(32, 0, 32, 32);
    ray.addColorStop(0, 'rgba(255, 243, 183, 0)');
    ray.addColorStop(.65, 'rgba(255, 238, 166, .28)');
    ray.addColorStop(1, 'rgba(255, 250, 218, .82)');
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(30, 32); ctx.lineTo(32, 0); ctx.lineTo(34, 32);
    ctx.lineTo(32, 64); ctx.lineTo(30, 32); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(32, 30); ctx.lineTo(64, 32); ctx.lineTo(32, 34);
    ctx.lineTo(0, 32); ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    opacity: .95
  }));
  glow.scale.setScalar(.62);
  snitch.add(glow);
  const snitchLight = new THREE.PointLight(0xffd47e, .35, 3.5, 2);
  snitch.add(snitchLight);
  snitch.scale.setScalar(1.45);
  world.add(snitch);

  // A small four-point glint makes the Snitch easy to spot without swallowing
  // its silhouette in a cloud of orange light.
  function makeAuraTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 44);
    g.addColorStop(0, 'rgba(255, 252, 231, .74)');
    g.addColorStop(.28, 'rgba(255, 231, 159, .26)');
    g.addColorStop(1, 'rgba(255, 217, 108, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(16, 16, 96, 96);
    ctx.strokeStyle = 'rgba(255, 247, 210, .9)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(64, 17); ctx.lineTo(64, 47);
    ctx.moveTo(64, 81); ctx.lineTo(64, 111);
    ctx.moveTo(17, 64); ctx.lineTo(47, 64);
    ctx.moveTo(81, 64); ctx.lineTo(111, 64);
    ctx.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const snitchAura = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeAuraTexture(),
    transparent: true,
    depthWrite: false,
    opacity: .58,
    color: 0xffedb8
  }));
  snitchAura.scale.setScalar(.86);
  world.add(snitchAura);

  // A trail of crisp little gold shards. Instancing keeps it to one draw call,
  // and real geometry avoids the point-sprite ambiguity of the low-res pass.
  const TRAIL_COUNT = 100;
  const trailGeo = new THREE.OctahedronGeometry(.115, 0);
  const trailMat = new THREE.MeshBasicMaterial({
    color: 0xf2be4f, transparent: true, opacity: .82,
    depthWrite: false, toneMapped: false
  });
  const trail = new THREE.InstancedMesh(trailGeo, trailMat, TRAIL_COUNT);
  trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trail.frustumCulled = false;
  trail.castShadow = false;
  trail.renderOrder = 2;
  const trailDummy = new THREE.Object3D();
  for (let i = 0; i < TRAIL_COUNT; i++) {
    trail.setColorAt(i, new THREE.Color(i % 3 === 0 ? 0xffe6a4 : (i % 3 === 1 ? 0xf4c04a : 0xd8952e)));
    trailDummy.position.set(0, -100, 0);
    trailDummy.scale.setScalar(0);
    trailDummy.updateMatrix();
    trail.setMatrixAt(i, trailDummy.matrix);
  }
  trail.instanceColor.needsUpdate = true;
  world.add(trail);

  const trailNodes = [];
  let lastTrailTime = -1;

  function updateTrail(t, dt, snitchPos) {
    const interval = snitchBoost > 0 ? .009 : .016;
    if (t - lastTrailTime > interval) {
      trailNodes.push({
        pos: snitchPos.clone().add(new THREE.Vector3(rr(-.11, .11), rr(-.09, .09), rr(-.11, .11))),
        age: 0, life: rr(.8, 1.65),
        drift: new THREE.Vector3(rr(-.25, .25), rr(.18, .55), rr(-.25, .25)),
        size: rr(.65, 1.25) * (snitchBoost > 0 ? 1.35 : 1), spin: rr(-4, 4)
      });
      lastTrailTime = t;
      if (trailNodes.length > TRAIL_COUNT) trailNodes.shift();
    }
    for (const node of trailNodes) node.age += dt;
    for (let i = trailNodes.length - 1; i >= 0; i--) {
      if (trailNodes[i].age >= trailNodes[i].life) trailNodes.splice(i, 1);
    }
    for (let i = 0; i < TRAIL_COUNT; i++) {
      if (i < trailNodes.length) {
        const n = trailNodes[i];
        const life = 1 - n.age / n.life;
        trailDummy.position.set(
          n.pos.x + n.drift.x * n.age,
          n.pos.y + n.drift.y * n.age,
          n.pos.z + n.drift.z * n.age
        );
        trailDummy.rotation.set(n.age * n.spin, n.age * n.spin * .6, 0);
        trailDummy.scale.setScalar(n.size * (0.45 + life * 0.75));
      } else {
        trailDummy.position.set(0, -100, 0);
        trailDummy.scale.setScalar(0);
      }
      trailDummy.updateMatrix();
      trail.setMatrixAt(i, trailDummy.matrix);
    }
    trail.instanceMatrix.needsUpdate = true;
  }

  /* -----------------------------------------------------------------------
     Weather systems: rain, snow, lightning and the three sky palettes
     ----------------------------------------------------------------------- */
  const WEATHER = {
    clear: {
      theme: 'clear',
      sky: new THREE.Color(0xfbfaf6),
      exposure: 1.14,
      sunColor: new THREE.Color(0xfff0cf),
      sunIntensity: 3.15,
      hemiSky: new THREE.Color(0xf9fbff),
      hemiGround: new THREE.Color(0xa89273),
      hemiIntensity: 1.55,
      fillColor: new THREE.Color(0xd7e8ff),
      fillIntensity: .55,
      fogNear: 0,
      fogFar: 0,
      wind: 1,
      rimColor: 0xb3a27f,
      rimOpacity: .36,
      status: 'The sun breaks over the stadium'
    },
    storm: {
      theme: 'storm',
      sky: new THREE.Color(0x5d707a),
      exposure: .98,
      sunColor: new THREE.Color(0xbfd2df),
      sunIntensity: 1.3,
      hemiSky: new THREE.Color(0x94aab7),
      hemiGround: new THREE.Color(0x35433f),
      hemiIntensity: 1.08,
      fillColor: new THREE.Color(0x9cb9cd),
      fillIntensity: .45,
      fogNear: 55,
      fogFar: 105,
      wind: 2.25,
      rimColor: 0x4b5e51,
      rimOpacity: .5,
      status: 'Thunder rolls over the castle'
    },
    winter: {
      theme: 'winter',
      sky: new THREE.Color(0xcbdde4),
      exposure: 1.02,
      sunColor: new THREE.Color(0xe8f5ff),
      sunIntensity: 2.45,
      hemiSky: new THREE.Color(0xffffff),
      hemiGround: new THREE.Color(0x97aab0),
      hemiIntensity: 1.85,
      fillColor: new THREE.Color(0xc7e5ff),
      fillIntensity: .55,
      fogNear: 68,
      fogFar: 115,
      wind: 1.4,
      rimColor: 0xc5d7dd,
      rimOpacity: .5,
      status: 'Snow settles over the stands'
    }
  };

  let activeWeather = 'clear';
  let pendingWeather = null;
  let weatherSwitchTimer = 0;
  let weatherWind = 1;
  let lightningTimer = 4.5;
  let lightningEnergy = 0;

  const flashSky = new THREE.Color(0xdcebf5);
  const flashLight = new THREE.DirectionalLight(0xd6ebff, 0);
  flashLight.position.set(-10, 24, 13);
  flashLight.target.position.set(0, 2, 0);
  scene.add(flashLight, flashLight.target);

  function makeSnowflakeTexture() {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 32, 32);
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 9);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(.5, 'rgba(255,255,255,.92)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(5, 5, 22, 22);
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 1.2;
    ctx.translate(16, 16);
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.lineTo(0, 10);
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const snowflakeTexture = makeSnowflakeTexture();

  function createRain() {
    const count = 430;
    const positions = new Float32Array(count * 6);
    const drops = [];
    for (let i = 0; i < count; i++) {
      drops.push({
        x: rr(-20, 20), y: rr(-2, 14), z: rr(-14, 14),
        speed: rr(9, 17), len: rr(.25, .7)
      });
    }
    for (let i = 0; i < count; i++) {
      const drop = drops[i];
      const base = i * 6;
      positions[base] = drop.x;
      positions[base + 1] = drop.y;
      positions[base + 2] = drop.z;
      positions[base + 3] = drop.x - .18;
      positions[base + 4] = drop.y + drop.len;
      positions[base + 5] = drop.z + .03;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xc8dde7, transparent: true, opacity: .38, depthWrite: false
    });
    const mesh = new THREE.LineSegments(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.userData.drops = drops;
    mesh.userData.positions = positions;
    world.add(mesh);
    return mesh;
  }
  const rain = createRain();

  function createSnowLayer(count, size, opacity, color) {
    const positions = new Float32Array(count * 3);
    const flakes = [];
    for (let i = 0; i < count; i++) {
      flakes.push({
        x: rr(-19, 19), y: rr(-.5, 10.5), z: rr(-14, 14),
        speed: rr(.38, 1.05), sway: rr(.1, .6), phase: rr(0, 6.28),
        drift: rr(-.24, .24)
      });
    }
    for (let i = 0; i < count; i++) {
      const f = flakes[i];
      positions[i * 3] = f.x;
      positions[i * 3 + 1] = f.y;
      positions[i * 3 + 2] = f.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size, sizeAttenuation: false, map: snowflakeTexture,
      transparent: true, opacity, alphaTest: .04, depthWrite: false
    });
    const mesh = new THREE.Points(geo, mat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.userData.flakes = flakes;
    mesh.userData.positions = positions;
    world.add(mesh);
    return mesh;
  }
  const snowNear = createSnowLayer(430, 4.2, .95, 0xffffff);
  const snowFar = createSnowLayer(360, 2.8, .72, 0xc2d8e1);

  // Rain rings pop across the wet pitch during a storm.
  const SPLASH_COUNT = 28;
  const splashMesh = new THREE.InstancedMesh(
    new THREE.RingGeometry(.055, .085, 8),
    new THREE.MeshBasicMaterial({
      color: 0xbfe0ea, transparent: true, opacity: .55,
      side: THREE.DoubleSide, depthWrite: false
    }),
    SPLASH_COUNT
  );
  splashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  splashMesh.frustumCulled = false;
  splashMesh.visible = false;
  splashMesh.renderOrder = 1;
  world.add(splashMesh);
  const splashData = [];
  const splashDummy = new THREE.Object3D();
  for (let i = 0; i < SPLASH_COUNT; i++) {
    splashData.push({
      x: rr(-13, 13), z: rr(-7.2, 7.2),
      age: rr(0, 1), life: rr(.35, .8)
    });
  }

  function updateSplashes(dt) {
    splashMesh.visible = activeWeather === 'storm';
    if (!splashMesh.visible) return;
    for (let i = 0; i < SPLASH_COUNT; i++) {
      const s = splashData[i];
      s.age += dt;
      if (s.age >= s.life) {
        s.age = 0;
        s.life = rr(.35, .8);
        s.x = rr(-13, 13);
        s.z = rr(-7.2, 7.2);
      }
      const p = s.age / s.life;
      splashDummy.position.set(s.x, .075, s.z);
      splashDummy.rotation.set(-Math.PI / 2, 0, 0);
      splashDummy.scale.setScalar(.5 + p * 2.7);
      splashDummy.updateMatrix();
      splashMesh.setMatrixAt(i, splashDummy.matrix);
    }
    splashMesh.instanceMatrix.needsUpdate = true;
  }

  // Faint broom tracks pressed into the snow; winter-only set dressing.
  const snowTracks = new THREE.Group();
  snowTracks.visible = false;
  world.add(snowTracks);
  (function buildSnowTracks() {
    const trackMat = new THREE.LineBasicMaterial({
      color: 0xa8c1ca, transparent: true, opacity: .55
    });
    const arcs = [
      [[-12, 4.8], [-5, 3.1], [2, 4.4], [9, 2.1], [12.6, 3.6]],
      [[-11.5, -3.8], [-4, -5.2], [3, -2.6], [9, -4.0]],
      [[-6, 6.3], [-1, 2.8], [4, 0.4], [8, -2.4]],
      [[-10, -1.1], [-4.5, .7], [1.2, -0.6], [6, 1.1], [11, -.4]]
    ];
    for (const pairs of arcs) {
      const pts = pairs.map(([x, z]) => new THREE.Vector3(x, .076, z));
      const curve = new THREE.CatmullRomCurve3(pts);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(36)),
        trackMat
      );
      line.renderOrder = 1;
      snowTracks.add(line);
    }
  })();

  function triggerLightning() {
    if (reduceMotion || !lightningFlashEl) return;
    lightningFlashEl.classList.remove('is-on');
    // Force a reflow so consecutive strikes restart the CSS animation.
    void lightningFlashEl.offsetWidth;
    lightningFlashEl.classList.add('is-on');
    AudioEngine.thunder();
  }

  function updateRain(dt) {
    if (!rain.visible) return;
    const d = rain.userData.drops;
    const arr = rain.userData.positions;
    for (let i = 0; i < d.length; i++) {
      const drop = d[i];
      drop.x += dt * 1.2;
      drop.y -= drop.speed * dt;
      if (drop.y < -2.4) {
        drop.y = rr(10, 15);
        drop.x = rr(-20, 20);
        drop.z = rr(-14, 14);
      }
      const base = i * 6;
      arr[base] = drop.x;
      arr[base + 1] = drop.y;
      arr[base + 2] = drop.z;
      arr[base + 3] = drop.x - .18;
      arr[base + 4] = drop.y + drop.len;
      arr[base + 5] = drop.z + .03;
    }
    rain.geometry.attributes.position.needsUpdate = true;
  }

  function updateSnow(dt, t) {
    if (!snowNear.visible) return;
    for (const layer of [snowNear, snowFar]) {
      const flakes = layer.userData.flakes;
      const arr = layer.userData.positions;
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        f.y -= f.speed * dt;
        f.x += (f.drift + Math.sin(t * .55 + f.phase) * f.sway) * dt;
        if (f.y < -.4) {
          f.y = rr(8.5, 11.5);
          f.x = rr(-19, 19);
          f.z = rr(-14, 14);
        }
        if (f.x < -20) f.x = 20;
        if (f.x > 20) f.x = -20;
        arr[i * 3] = f.x;
        arr[i * 3 + 1] = f.y;
        arr[i * 3 + 2] = f.z;
      }
      layer.geometry.attributes.position.needsUpdate = true;
    }
  }

  function updateWeatherEffects(dt, t) {
    const w = WEATHER[activeWeather];
    const wasStorm = activeWeather === 'storm';
    if (wasStorm && !reduceMotion) {
      lightningTimer -= dt;
      if (lightningTimer <= 0) {
        lightningTimer = rr(3.6, 8.5);
        lightningEnergy = 1;
        triggerLightning();
      }
      lightningEnergy = Math.max(0, lightningEnergy - dt * 4.8);
      flashLight.intensity = lightningEnergy * (7.5 + Math.sin(t * 65) * 2.2);
    } else {
      lightningEnergy = Math.max(0, lightningEnergy - dt * 8);
      flashLight.intensity = 0;
    }

    const breathe = paused ? 0 : Math.sin(t * .18) * .06;
    sun.intensity = w.sunIntensity + breathe + lightningEnergy * 3.2;
    hemi.intensity = w.hemiIntensity + (paused ? 0 : Math.sin(t * .14 + 1.3) * .025) + lightningEnergy * .38;
    fill.intensity = w.fillIntensity;

    if (scene.background) {
      scene.background.copy(w.sky);
      if (lightningEnergy > 0) scene.background.lerp(flashSky, lightningEnergy * .34);
    }

    updateRain(dt);
    updateSnow(dt, t);
  }

  /* -----------------------------------------------------------------------
     Procedural sound: crowd, wind, rain, thunder, whooshes and chimes.
     Audio starts only after an explicit sound-button gesture.
     ----------------------------------------------------------------------- */
  const AudioEngine = (() => {
    let ctx = null;
    let master = null;
    let ready = false;
    let enabled = false;
    let weatherKey = 'clear';
    let noiseBuffer = null;
    let crowdGain = null;
    let windGain = null;
    let rainGain = null;

    function makeNoiseBuffer(seconds) {
      const length = Math.floor(ctx.sampleRate * seconds);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        brown = (brown + .018 * white) / 1.018;
        data[i] = white * .62 + brown * 2.5;
      }
      return buffer;
    }

    function ambientGain(current, target, time) {
      if (!current) return;
      const t = time || .8;
      current.gain.cancelScheduledValues(ctx.currentTime);
      current.gain.setTargetAtTime(target, ctx.currentTime, t);
    }

    function setWeatherGains() {
      if (!ready) return;
      if (weatherKey === 'storm') {
        ambientGain(crowdGain, .15);
        ambientGain(windGain, .17);
        ambientGain(rainGain, .11);
      } else if (weatherKey === 'winter') {
        ambientGain(crowdGain, .085);
        ambientGain(windGain, .075);
        ambientGain(rainGain, 0);
      } else {
        ambientGain(crowdGain, .13);
        ambientGain(windGain, .03);
        ambientGain(rainGain, 0);
      }
    }

    function init() {
      if (ready) {
        if (ctx.state === 'suspended') ctx.resume();
        return true;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      try {
        ctx = new Ctx();
        master = ctx.createGain();
        master.gain.value = enabled ? .28 : 0;
        master.connect(ctx.destination);
        noiseBuffer = makeNoiseBuffer(3.2);

        // Crowd murmur.
        const crowd = ctx.createBufferSource();
        crowd.buffer = noiseBuffer;
        crowd.loop = true;
        const crowdFilter = ctx.createBiquadFilter();
        crowdFilter.type = 'bandpass';
        crowdFilter.frequency.value = 460;
        crowdFilter.Q.value = .45;
        crowdGain = ctx.createGain();
        crowdGain.gain.value = .12;
        crowd.connect(crowdFilter).connect(crowdGain).connect(master);
        crowd.start();

        // Wind bed.
        const wind = ctx.createBufferSource();
        wind.buffer = noiseBuffer;
        wind.loop = true;
        const windFilter = ctx.createBiquadFilter();
        windFilter.type = 'lowpass';
        windFilter.frequency.value = 420;
        windFilter.Q.value = .3;
        windGain = ctx.createGain();
        windGain.gain.value = .03;
        wind.connect(windFilter).connect(windGain).connect(master);
        wind.start();

        // Rain bed.
        const rainSound = ctx.createBufferSource();
        rainSound.buffer = noiseBuffer;
        rainSound.loop = true;
        const rainHigh = ctx.createBiquadFilter();
        rainHigh.type = 'highpass';
        rainHigh.frequency.value = 1500;
        const rainLow = ctx.createBiquadFilter();
        rainLow.type = 'lowpass';
        rainLow.frequency.value = 6200;
        rainGain = ctx.createGain();
        rainGain.gain.value = 0;
        rainSound.connect(rainHigh).connect(rainLow).connect(rainGain).connect(master);
        rainSound.start();

        ready = true;
        setWeatherGains();
        if (ctx.state === 'suspended') ctx.resume();
        return true;
      } catch (err) {
        console.warn('Audio unavailable', err);
        return false;
      }
    }

    function tone(freq, duration, type, volume, delay) {
      if (!enabled || !ctx) return;
      const at = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(volume, at + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + duration + .03);
    }

    function noiseBurst(duration, filterType, startFreq, endFreq, volume, q) {
      if (!enabled || !ctx || !noiseBuffer) return;
      const at = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType || 'bandpass';
      filter.frequency.setValueAtTime(startFreq, at);
      if (endFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), at + duration);
      filter.Q.value = q || .8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.exponentialRampToValueAtTime(volume, at + .03);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      src.connect(filter).connect(gain).connect(master);
      src.start(at);
      src.stop(at + duration + .05);
    }

    return {
      get enabled() { return enabled; },
      setEnabled(on) {
        if (on) {
          enabled = true;
          if (!init()) {
            enabled = false;
            return false;
          }
          if (master) master.gain.setTargetAtTime(.3, ctx.currentTime, .15);
          if (ctx.state === 'suspended') ctx.resume();
          setWeatherGains();
          tone(1318.5, .38, 'sine', .045);
          tone(1975.5, .5, 'sine', .028, .08);
        } else {
          enabled = false;
          if (master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, .12);
        }
        return enabled;
      },
      setWeather(key) {
        weatherKey = key;
        if (ready) setWeatherGains();
      },
      whoosh() {
        if (!enabled) return;
        noiseBurst(.26, 'bandpass', 320, 1700, .055, .75);
      },
      thunder() {
        if (!enabled) return;
        noiseBurst(1.9, 'lowpass', 155, 70, .26, .2);
        tone(43, 1.4, 'sine', .1);
        noiseBurst(.32, 'highpass', 1700, 800, .06, .3);
      },
      chime() {
        if (!enabled) return;
        tone(2093, .55, 'sine', .04);
        tone(3136, .42, 'sine', .018, .05);
      },
      cheer(intensity) {
        if (!enabled) return;
        const power = clamp(intensity || 1, .3, 1.5);
        noiseBurst(1.0 + power * .5, 'bandpass', 360, 720, .12 * power, .55);
        noiseBurst(.65, 'bandpass', 680, 980, .07 * power, .7);
      },
      save() {
        if (!enabled) return;
        noiseBurst(.55, 'bandpass', 500, 880, .09, .6);
        tone(294, .18, 'triangle', .03);
      },
      goal() {
        if (!enabled) return;
        this.cheer(1.45);
        tone(523.25, .35, 'triangle', .045);
        tone(659.25, .42, 'triangle', .035, .09);
        tone(783.99, .55, 'triangle', .03, .18);
      }
    };
  })();

  /* -----------------------------------------------------------------------
     Flight
     ----------------------------------------------------------------------- */
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const qYaw = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const qBank = new THREE.Quaternion();
  const tempPoint = new THREE.Vector3();
  const tempTangent = new THREE.Vector3();
  const tempSide = new THREE.Vector3();
  const tempNext = new THREE.Vector3();

  function orientRider(rider, pos, tangent, bank, dt, lookYawOverride) {
    rider.position.copy(pos);
    const yaw = lookYawOverride === undefined
      ? Math.atan2(-tangent.z, tangent.x)
      : lookYawOverride;
    const pitch = lookYawOverride === undefined
      ? Math.asin(clamp(tangent.y, -.55, .55))
      : 0;
    qYaw.setFromAxisAngle(Y_AXIS, yaw);
    qPitch.setFromAxisAngle(Z_AXIS, pitch);
    const targetBank = clamp(bank, -.52, .52);
    const damp = 1 - Math.exp(-dt * 6.5);
    rider.userData.bank = lerp(rider.userData.bank, targetBank, damp);
    qBank.setFromAxisAngle(X_AXIS, rider.userData.bank);
    rider.quaternion.copy(qYaw).multiply(qPitch).multiply(qBank);
  }

  function updateCurveRider(rider, curve, t, dt) {
    const flight = rider.userData.flight;
    let u = (flight.offset + t * flight.speed) % 1;
    if (u < 0) u += 1;
    curve.getPointAt(u, tempPoint);
    curve.getTangentAt(u, tempTangent).normalize();
    if (flight.lateral) {
      tempSide.crossVectors(Y_AXIS, tempTangent).normalize();
      tempPoint.addScaledVector(tempSide, flight.lateral);
    }
    tempPoint.y += (flight.verticalOffset || 0) + Math.sin(t * 2.35 + rider.userData.flight.birdPhase) * .065;

    curve.getTangentAt((u + .0035) % 1, tempNext).normalize();
    const yawNow = Math.atan2(-tempTangent.z, tempTangent.x);
    const yawNext = Math.atan2(-tempNext.z, tempNext.x);
    const turn = wrapAngle(yawNext - yawNow);
    let bank = -turn * 10.2 + Math.sin(t * .87 + flight.birdPhase) * .04;
    orientRider(rider, tempPoint, tempTangent, bank, dt);

    // Secondary pitch / lean, so the broom breathes rather than glides rigidly.
    rider.userData.model.rotation.x = Math.sin(t * 1.9 + flight.birdPhase) * .042;
    rider.userData.model.position.y = Math.sin(t * 3.4 + flight.birdPhase) * .028;
    animateRiderCloth(rider, t * 1.9, 1);
    return u;
  }

  let heroU = 0;
  function updateHero(t, dt) {
    heroU = updateCurveRider(hero, heroCurve, t, dt);
    const u = heroU;
    heroCurve.getPointAt(u, tempPoint);
    heroCurve.getTangentAt(u, tempTangent).normalize();
    tempSide.crossVectors(Y_AXIS, tempTangent).normalize();
    const flourishP = snitchFlourishDuration > 0
      ? clamp(1 - snitchFlourishTime / snitchFlourishDuration, 0, 1) : 0;
    const flourishFade = snitchFlourishActive
      ? Math.sin(clamp(flourishP, 0, 1) * Math.PI) : 0;
    const dodgeSide = snitchFlourishActive
      ? Math.sin(flourishP * Math.PI * 3.4) * .5 * flourishFade : 0;
    const dodgeY = snitchFlourishActive
      ? Math.sin(flourishP * Math.PI * 2) * .42 * flourishFade : 0;
    const snitchPos = tempPoint.clone()
      .addScaledVector(tempTangent, 2.3)
      .addScaledVector(tempSide, .48 + Math.sin(t * 2.35 + 1.2) * .26 + dodgeSide)
      .add(new THREE.Vector3(0, 1.12 + Math.sin(t * 3.1) * .15 + dodgeY, 0));
    snitch.position.copy(snitchPos);
    snitchAura.position.copy(snitchPos);
    const boost = clamp(snitchBoost / 2.2, 0, 1);
    snitchAura.scale.setScalar((.84 + Math.sin(t * 3.8) * .05) * (1 + boost * .48 + flourishFade * .18));
    snitchAura.material.opacity = .42 + Math.sin(t * 4.3) * .08 + boost * .2;
    snitch.rotation.y = Math.atan2(-tempTangent.z, tempTangent.x) - .2;
    snitch.rotation.z = Math.sin(t * 2.2) * .12;

    const flap = Math.sin(t * 30.0) * .72;
    wingL.rotation.x = .15 + flap * .55;
    wingR.rotation.x = .15 + flap * .55;
    wingL.rotation.z = Math.sin(t * 30 + .4) * .18;
    wingR.rotation.z = -Math.sin(t * 30 + .4) * .18;
    glow.material.opacity = .8 + Math.sin(t * 4.6) * .1 + boost * .14;
    snitch.scale.setScalar(1.45 + Math.sin(t * 5.3) * .035 + boost * .22);

    // A short swoop and lean when the Snitch teases another near-catch.
    hero.userData.model.rotation.z = snitchFlourishActive
      ? Math.sin(flourishP * Math.PI * 2) * .38 * flourishFade : 0;
    if (snitchFlourishActive) hero.position.y -= flourishFade * .13;
    if (snitchTag) snitchTag.classList.toggle('is-boosted', boost > .15);
    updateTrail(t, dt, snitchPos);
  }

  function updateRival(t, dt) {
    updateCurveRider(rival, rivalCurve, t, dt);
    // An extra, slightly human turn of the head toward the Snitch.
    rival.userData.model.rotation.x += Math.sin(t * .8 + 1) * .015;
  }

  function updateKeeper(t, dt) {
    const z = Math.sin(t * 1.65 + .8) * 2.7 + Math.sin(t * 3.1) * .17;
    const y = 3.42 + Math.sin(t * 2.7 + .4) * .15;
    const x = 12.3 + Math.sin(t * 1.65 + .8) * .16;
    const pos = new THREE.Vector3(x, y, z);
    const velZ = Math.cos(t * 1.65 + .8) * 2.7 * 1.65;
    const bank = -velZ * .18;
    let diveLean = 0;
    if (keeperReaction.house === 'gryffindor' && keeperReaction.weight > .001) {
      const w = keeperReaction.weight;
      pos.x += (keeperReaction.target.x - pos.x) * .72 * w;
      pos.y += (keeperReaction.target.y - pos.y) * .5 * w;
      pos.z += (keeperReaction.target.z - pos.z) * .8 * w;
      diveLean = -w * .62;
    }
    const tangent = new THREE.Vector3(-.18, .06, velZ).normalize();
    orientRider(keeper, pos, tangent, bank, dt, Math.PI * .93 + Math.sin(t * .5) * .07);
    keeper.userData.model.rotation.z = Math.sin(t * 1.9) * .028 + diveLean;
    animateRiderCloth(keeper, t * 1.85, 1);
  }

  function updateChaser(t, dt) {
    updateCurveRider(chaser, chaserCurve, t, dt);
    // A proud, gentle pose while carrying the Quaffle.
    chaser.userData.model.rotation.z = Math.sin(t * 1.7 + .8) * .028;
  }

  /* -----------------------------------------------------------------------
     Camera fitting
     ----------------------------------------------------------------------- */
  const fitPoints = [];
  function addFitPoint(x, y, z) { fitPoints.push(new THREE.Vector3(x, y, z)); }
  // Base silhouette.
  for (const x of [-18.9, 18.9]) for (const z of [-12.85, 12.85]) {
    addFitPoint(x, -2.5, z);
    addFitPoint(x, .12, z);
  }
  // Architecture tops.
  for (const t of cornerTowers) {
    addFitPoint(t.x, t.height + .33 + t.roofHeight + 1.5, t.z);
    addFitPoint(t.x, t.height + .33 + t.roofHeight + .9, t.z);
  }
  addFitPoint(-1.25, 8.15, -11.85);
  addFitPoint(-7.35, 6.1, -11.18);
  addFitPoint(7.9, 6.35, -11.68);
  addFitPoint(-12.15, 3.9, -11.1);
  addFitPoint(12.15, 3.9, -11.1);
  // The larger Hogwarts backdrop, kept separate from the pitch's airspace.
  addFitPoint(-4.7, 10.0, -17.9);
  addFitPoint(2.8, 13.5, -18.2);
  addFitPoint(-10.8, 8.9, -17.6);
  addFitPoint(11.1, 8.3, -16.2);
  addFitPoint(-14.6, 7.2, -15.9);
  // Goal hoops and flags.
  for (const sx of [-1, 1]) for (const z of [-3.35, 0, 3.35]) addFitPoint(sx * 14.2, 6.0, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addFitPoint(sx * 14.1, 2.6, sz * 8.0);
  // The action airspace.
  for (let i = 0; i < 14; i++) {
    const p = heroCurve.getPointAt(i / 14);
    addFitPoint(p.x, p.y + .55, p.z);
    const rp = rivalCurve.getPointAt(i / 14);
    addFitPoint(rp.x, rp.y + .55, rp.z);
  }
  addFitPoint(12.3, 4.0, 2.8);
  addFitPoint(12.3, 4.0, -2.8);
  addFitPoint(-12.3, 4.0, 2.8);
  addFitPoint(-12.3, 4.0, -2.8);
  for (const r of formationRiders) {
    const f = r.userData.flight;
    if (!f.curve) continue;
    for (let i = 0; i < 8; i++) {
      const p = f.curve.getPointAt(i / 8);
      addFitPoint(p.x, p.y + (f.altitude || 0) + 1.0, p.z);
    }
  }

  const fitCenter = new THREE.Vector3();
  let fitPaddingX = embedded ? .86 : .9;
  let fitPaddingY = embedded ? .80 : .9;

  function fitCameraToScene() {
    camera.position.copy(ISO_DIR).multiplyScalar(64);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(camera.matrixWorld).invert();
    const p = new THREE.Vector3();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const point of fitPoints) {
      p.copy(point).applyMatrix4(inv);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const aspect = Math.max(.3, window.innerWidth / Math.max(1, window.innerHeight));
    const frameH = Math.max(contentH / fitPaddingY, contentW / (aspect * fitPaddingX));
    const frameW = frameH * aspect;
    camera.left = cx - frameW / 2;
    camera.right = cx + frameW / 2;
    camera.top = cy + frameH / 2;
    camera.bottom = cy - frameH / 2;
    camera.updateProjectionMatrix();
    fitCenter.set(cx, cy, 0);
  }

  /* -----------------------------------------------------------------------
     Responsive, deliberately low-resolution rendering = pixel-art rendering
     ----------------------------------------------------------------------- */
  let pixelHeight = 0;
  let pixelWidth = 0;
  function resize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const aspect = w / h;
    // Keeping the internal buffer intentionally small is the pixel-art pass:
    // the canvas is enlarged in the browser with nearest-neighbour filtering.
    let ih = Math.round(clamp(h / 2.7, 332, 492));
    if (aspect < 1) ih = Math.round(clamp(h / 2.5, 460, 580));
    let iw = Math.round(ih * aspect);
    if (iw < 260) {
      iw = 260;
      ih = Math.round(iw / aspect);
    }
    if (embedded) {
      iw = Math.round(clamp(w, 220, 480));
      ih = Math.round(iw / aspect);
    }
    pixelWidth = iw;
    pixelHeight = ih;
    renderer.setSize(iw, ih, false);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    fitCameraToScene();
    if (renderReady) renderer.render(scene, camera);
  }

  window.addEventListener('resize', resize, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize, { passive: true });
  }
  resize();

  /* -----------------------------------------------------------------------
     UI
     ----------------------------------------------------------------------- */
  let paused = reduceMotion;
  if (paused) {
    motionButton.dataset.paused = 'true';
    motionButton.setAttribute('aria-pressed', 'true');
    motionButton.querySelector('.label').textContent = 'Resume play';
    statusText.textContent = 'Flight held for a quiet look';
  }

  motionButton.addEventListener('click', () => {
    hidePlayerTip();
    paused = !paused;
    motionButton.dataset.paused = paused ? 'true' : 'false';
    motionButton.setAttribute('aria-pressed', paused ? 'true' : 'false');
    motionButton.querySelector('.label').textContent = paused ? 'Resume play' : 'Hold flight';
    if (paused) {
      statusText.textContent = 'Flight held for a quiet look';
    } else {
      statusIndex = 0;
      statusTimer = 0;
      statusLock = 0;
      statusText.textContent = statusLines[0];
    }
  });

  const statusLines = [
    'Potter gains on the Snitch',
    'Malfoy holds the inside line',
    'The Snitch breaks toward the stands',
    'The crowd holds its breath',
    'Hover or tap a rider to inspect the squad',
    'Click a house banner to raise a cheer',
    'Press H for a highlight · M for sound'
  ];
  let statusIndex = 0;
  let statusTimer = 0;
  let statusSwapTimer = 0;
  let statusLock = 0;

  function showStatus(text, hold) {
    if (!statusText || !text) return;
    statusText.textContent = text;
    statusText.classList.remove('is-out');
    statusTimer = 0;
    statusSwapTimer = 0;
    statusLock = hold === undefined ? 2.6 : hold;
  }

  function updateStatus(dt) {
    if (paused) return;
    if (statusLock > 0) {
      statusLock = Math.max(0, statusLock - dt);
      return;
    }
    statusTimer += dt;
    if (statusTimer > 5.6) {
      statusTimer = 0;
      statusIndex = (statusIndex + 1) % statusLines.length;
      statusText.classList.add('is-out');
      statusSwapTimer = 0;
    }
    if (statusSwapTimer < .31 && statusText.classList.contains('is-out')) {
      statusSwapTimer += dt;
      if (statusSwapTimer > .16) {
        statusText.textContent = statusLines[statusIndex];
        statusText.classList.remove('is-out');
      }
    }
  }

  const snitchScreen = new THREE.Vector3();
  function updateSnitchTag() {
    if (!snitchTag) return;
    snitchScreen.copy(snitch.position).project(camera);
    const x = clamp((snitchScreen.x * .5 + .5) * window.innerWidth, 84, window.innerWidth - 84);
    const y = clamp((-snitchScreen.y * .5 + .5) * window.innerHeight - 18, 58, window.innerHeight - 76);
    snitchTag.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    snitchTag.classList.add('is-visible');
  }

  /* -----------------------------------------------------------------------
     Weather selection
     ----------------------------------------------------------------------- */
  function syncWeatherButtons(key) {
    for (const btn of weatherButtons) {
      const active = btn.dataset.weather === key;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function applyWeather(key, announce) {
    const w = WEATHER[key];
    if (!w) return;
    activeWeather = key;

    document.body.classList.remove('weather-clear', 'weather-storm', 'weather-winter');
    document.body.classList.add('weather-' + w.theme);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', '#' + w.sky.getHexString());

    if (scene.background) scene.background.copy(w.sky);
    sun.color.copy(w.sunColor);
    sun.intensity = w.sunIntensity;
    hemi.color.copy(w.hemiSky);
    hemi.groundColor.copy(w.hemiGround);
    hemi.intensity = w.hemiIntensity;
    fill.color.copy(w.fillColor);
    fill.intensity = w.fillIntensity;
    renderer.toneMappingExposure = w.exposure;

    if (w.fogFar > 0) {
      scene.fog = new THREE.Fog(w.sky.getHex(), w.fogNear, w.fogFar);
    } else {
      scene.fog = null;
    }

    pitch.material = pitchMaterials[key];
    fieldRimMat.color.set(w.rimColor);
    fieldRimMat.opacity = w.rimOpacity;
    if (tuftMesh) {
      tuftMesh.visible = key !== 'winter';
      tuftMesh.material.color.set(key === 'storm' ? 0x49664e : 0x6f9d55);
    }
    for (const mesh of snowOverlays) mesh.visible = key === 'winter';
    if (crowdSnow) crowdSnow.visible = key === 'winter';
    snowTracks.visible = key === 'winter';
    for (const mist of backdropMistSprites) {
      mist.sprite.material.opacity = mist.baseOpacity * (key === 'storm' ? 1.45 : key === 'winter' ? 1.2 : 1);
    }

    rain.visible = key === 'storm';
    snowNear.visible = key === 'winter';
    snowFar.visible = key === 'winter';
    weatherWind = w.wind;
    AudioEngine.setWeather(key);
    lightningEnergy = 0;
    flashLight.intensity = 0;
    lightningTimer = rr(3.6, 8.5);
    if (lightningFlashEl) lightningFlashEl.classList.remove('is-on');

    syncWeatherButtons(key);
    if (announce && !paused) {
      showStatus(w.status, 2.8);
    }
  }

  function setWeather(key) {
    if (!WEATHER[key] || pendingWeather || key === activeWeather) return;
    pendingWeather = key;
    syncWeatherButtons(key);
    // Flip the HUD palette immediately so text stays readable while the veil
    // hides the field/material switch.
    document.body.classList.remove('weather-clear', 'weather-storm', 'weather-winter');
    document.body.classList.add('weather-' + WEATHER[key].theme);
    const transitionMeta = document.querySelector('meta[name="theme-color"]');
    if (transitionMeta) transitionMeta.setAttribute('content', '#' + WEATHER[key].sky.getHexString());
    if (weatherVeil) {
      weatherVeil.style.background = '#' + WEATHER[key].sky.getHexString();
      weatherVeil.classList.add('is-on');
    }
    clearTimeout(weatherSwitchTimer);
    weatherSwitchTimer = setTimeout(() => {
      applyWeather(key, true);
      pendingWeather = null;
      requestAnimationFrame(() => {
        if (weatherVeil) weatherVeil.classList.remove('is-on');
      });
    }, 230);
  }

  for (const btn of weatherButtons) {
    btn.addEventListener('click', () => {
      hidePlayerTip();
      setWeather(btn.dataset.weather);
    });
  }
  applyWeather('clear', false);

  /* -----------------------------------------------------------------------
     Interaction: hover cards, clickable banners, Snitch flare and controls
     ----------------------------------------------------------------------- */
  if (highlightButton) {
    highlightButton.addEventListener('click', () => {
      hidePlayerTip();
      requestHighlight();
    });
  }

  if (soundButton) {
    soundButton.addEventListener('click', () => {
      hidePlayerTip();
      const next = soundButton.getAttribute('aria-pressed') !== 'true';
      const actual = AudioEngine.setEnabled(next);
      soundButton.setAttribute('aria-pressed', actual ? 'true' : 'false');
      if (next && !actual) {
        showStatus('Sound is unavailable in this browser', 2.5);
      } else {
        showStatus(actual ? 'Sound on — crowd, wind and weather' : 'Sound off', 1.8);
      }
    });
  }

  function flareSnitch() {
    snitchBoost = Math.max(snitchBoost, 2.35);
    spawnSnitchBurst();
    AudioEngine.chime();
    setMatchStatus('The Golden Snitch blazes gold', 2.1);
    if (snitchTag) snitchTag.classList.add('is-boosted');
    hidePlayerTip();
  }

  if (snitchTag) {
    snitchTag.addEventListener('click', (event) => {
      event.stopPropagation();
      flareSnitch();
    });
    snitchTag.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        flareSnitch();
      }
    });
  }

  const pickables = [];
  const pickGeometry = new THREE.SphereGeometry(.95, 6, 4);
  const pickMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pickBoxMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

  function addPlayerPick(rider, name, role) {
    const hit = new THREE.Mesh(pickGeometry, pickMaterial);
    hit.position.set(.08, .24, 0);
    hit.layers.set(1);
    hit.castShadow = false;
    hit.receiveShadow = false;
    hit.userData.pick = { kind: 'player', rider, name, role };
    rider.add(hit);
    pickables.push(hit);
  }

  addPlayerPick(hero, 'HARRY POTTER', 'Gryffindor · Seeker');
  addPlayerPick(rival, 'DRACO MALFOY', 'Slytherin · Seeker');
  addPlayerPick(keeper, 'GRYFFINDOR KEEPER', 'Keeper · North hoops');
  addPlayerPick(chaser, 'SLYTHERIN CHASER', 'Chaser · Quaffle carrier');
  for (const rider of formationRiders) {
    const role = rider.userData.role;
    const label = role === 'keeper' ? 'KEEPER' : role.toUpperCase();
    const roleText = role === 'keeper'
      ? 'Keeper · South hoops'
      : role === 'beater' ? 'Beater · Iron bludgers' : 'Chaser · Starting seven';
    addPlayerPick(rider, rider.userData.house.name.toUpperCase() + ' ' + label, roleText);
  }

  function addBannerPick(x, y, z, w, h, d, houseKey, name) {
    const hit = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), pickBoxMaterial);
    hit.position.set(x, y, z);
    hit.layers.set(1);
    hit.castShadow = false;
    hit.receiveShadow = false;
    hit.userData.pick = { kind: 'banner', house: houseKey, name, role: 'Click to cheer' };
    world.add(hit);
    pickables.push(hit);
  }
  for (let i = 0; i < bannerHouseOrder.length; i++) {
    const key = bannerHouseOrder[i];
    addBannerPick([-8.85, -2.95, 2.95, 8.85][i], 1.72, -10.9, 1.95, 2.85, .55, key, HOUSE[key].name);
  }
  const nearHouses = housesForSides[0];
  const nearCenters = [-8.925, -3.075, 3.075, 8.925];
  for (let i = 0; i < 4; i++) {
    addBannerPick(nearCenters[i], .78, 11.6, 5.3, 1.05, .45, nearHouses[i], HOUSE[nearHouses[i]].name);
  }

  const snitchPick = new THREE.Mesh(new THREE.SphereGeometry(.58, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  snitchPick.layers.set(1);
  snitchPick.userData.pick = { kind: 'snitch', name: 'GOLDEN SNITCH', role: 'Click to flare' };
  snitch.add(snitchPick);
  pickables.push(snitchPick);

  const raycaster = new THREE.Raycaster();
  raycaster.layers.set(1);
  const pointerNdc = new THREE.Vector2();
  let hoverPick = null;
  let hoverMesh = null;
  let lastPointerX = null;
  let lastPointerY = null;
  const pickScreen = new THREE.Vector3();

  function hidePlayerTip() {
    if (!playerTip) return;
    playerTip.classList.remove('is-visible');
    playerTip.setAttribute('aria-hidden', 'true');
    hoverPick = null;
    hoverMesh = null;
    lastPointerX = null;
    lastPointerY = null;
    if (canvas) canvas.style.cursor = '';
  }

  function pickAt(clientX, clientY) {
    pointerNdc.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    return hits.length ? hits[0] : null;
  }

  function showPlayerTip(pick, mesh, clientX, clientY) {
    if (!playerTip) return;
    hoverPick = pick;
    hoverMesh = mesh;
    playerTipName.textContent = pick.name;
    playerTipRole.textContent = pick.role;
    const house = pick.rider && (pick.rider.userData.house || HOUSE[pick.rider.userData.houseKey]);
    const bannerHouse = pick.house ? HOUSE[pick.house] : null;
    playerTip.style.borderLeftColor = pick.kind === 'snitch'
      ? '#b0873e' : (house ? '#' + house.main.toString(16).padStart(6, '0')
        : bannerHouse ? '#' + bannerHouse.main.toString(16).padStart(6, '0') : '#b0873e');
    const x = Math.min(clientX + 14, window.innerWidth - 178);
    const y = Math.min(clientY + 18, window.innerHeight - 78);
    playerTip.style.left = Math.max(10, x) + 'px';
    playerTip.style.top = Math.max(10, y) + 'px';
    playerTip.classList.add('is-visible');
    playerTip.setAttribute('aria-hidden', 'false');
    if (canvas) canvas.style.cursor = 'pointer';
  }

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    if (event.target.closest && event.target.closest('button, .snitch-tag, .controls')) {
      lastPointerX = null;
      lastPointerY = null;
      hidePlayerTip();
      return;
    }
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    const hit = pickAt(event.clientX, event.clientY);
    if (hit) showPlayerTip(hit.object.userData.pick, hit.object, event.clientX, event.clientY);
    else hidePlayerTip();
  }, { passive: true });

  window.addEventListener('pointerleave', () => {
    lastPointerX = null;
    lastPointerY = null;
    hidePlayerTip();
  }, { passive: true });
  window.addEventListener('blur', hidePlayerTip);

  function cheerHouse(houseKey, source) {
    const house = HOUSE[houseKey];
    if (!house) return;
    houseCheer.key = houseKey;
    houseCheer.time = 2.6;
    crowdExcitement = Math.max(crowdExcitement, .9);
    tossCelebration(houseKey, 18);
    AudioEngine.cheer(1.1);
    setMatchStatus(house.name + ' roars!', 2.5);
    if (source) source.getWorldPosition(pickScreen);
    else pickScreen.set(0, 3, 0);
    spawnSparks(pickScreen, houseKey, 12, .7);
  }

  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest && event.target.closest('button, .snitch-tag, .controls')) return;
    const hit = pickAt(event.clientX, event.clientY);
    if (!hit) {
      hidePlayerTip();
      return;
    }
    const pick = hit.object.userData.pick;
    if (pick.kind === 'banner') {
      cheerHouse(pick.house, hit.object);
      hidePlayerTip();
    } else if (pick.kind === 'snitch') flareSnitch();
    else if (pick.kind === 'player') {
      setMatchStatus(pick.name + ' · ' + pick.role, 2.2);
      const p = new THREE.Vector3();
      pick.rider.getWorldPosition(p);
      spawnSparks(p, (pick.rider.userData.house && pick.rider.userData.house.key) || pick.rider.userData.houseKey || 'gold', 7, .5);
    }
  }, { passive: true });

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const active = document.activeElement;
    const tag = active && active.tagName ? active.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (event.code === 'Space') {
      // Let focused buttons and the Snitch label handle their own Space press.
      if (active && active.closest && active.closest('button, [role="button"]')) return;
      event.preventDefault();
      motionButton.click();
    } else if (event.key === '1') {
      setWeather('clear');
    } else if (event.key === '2') {
      setWeather('storm');
    } else if (event.key === '3') {
      setWeather('winter');
    } else if (event.key.toLowerCase() === 'h') {
      requestHighlight();
    } else if (event.key.toLowerCase() === 'm') {
      if (soundButton) soundButton.click();
    } else if (event.key === 'Escape') {
      hidePlayerTip();
    }
  });

  /* -----------------------------------------------------------------------
     Main loop
     ----------------------------------------------------------------------- */
  const clock = new THREE.Clock();
  let simTime = 0;
  let firstFrame = true;
  let lastFrameTime = 0;
  let embedActive = false;

  function animate(time = 0) {
    // A decorative sidebar does not need the full scene's refresh rate.
    if (embedded && !firstFrame && time - lastFrameTime < 1000 / 20) return;
    lastFrameTime = time;
    const dt = Math.min(.05, clock.getDelta());
    if (!paused) simTime += dt;

    const t = simTime;
    updateHero(t, dt);
    updateRival(t, dt);
    updateKeeper(t, dt);
    updateChaser(t, dt);
    for (const rider of formationRiders) {
      if (rider.userData.flight.kind === 'keeper') updateFormationKeeper(rider, t, dt);
      else updateFormationRider(rider, t, dt);
    }
    updateMatch(t, paused ? 0 : dt);
    updateBludgers(t, paused ? 0 : dt);
    updateSparks(paused ? 0 : dt);
    updateToss(paused ? 0 : dt);
    updateSplashes(dt);
    updateCrowd(t);
    updateBackdropLife(t, paused ? 0 : dt);
    animateClothMeshes(t);
    updateStatus(dt);
    updateWeatherEffects(dt, t);
    updateSnitchTag();

    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      document.body.classList.add('ready');
    }
  }

  function syncAnimation() {
    clock.getDelta(); // Discard time spent in a hidden tab or paused sidebar.
    lastFrameTime = 0;
    renderer.setAnimationLoop(!renderFailed && !document.hidden && (!embedded || embedActive) ? animate : null);
  }

  document.addEventListener('visibilitychange', syncAnimation);
  if (embedded) {
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      if (event.data?.type !== 'quidditch-visibility') return;
      const active = event.data.active === true;
      if (active === embedActive) return;
      embedActive = active;
      paused = !active;
      syncAnimation();
    });
  }

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    renderFailed = true;
    renderReady = false;
    renderer.setAnimationLoop(null);
    showFallback('The WebGL context was lost. Reload the scene to try again.');
  });

  renderReady = true;
  animate();
  syncAnimation();
  if (embedded) window.parent.postMessage({ type: 'quidditch-ready' }, window.location.origin);

  // A tiny debug handle is helpful when iterating on the diorama.
  window.__quidditch = {
    scene, camera, renderer, world, riders, formationRiders, snitch,
    snowOverlays, rain, snowNear, snowFar, setWeather,
    matchState, matchScore, beginAttack, triggerSnitchFlourish, triggerBeaterSwing,
    tossCelebration, cheerHouse, requestHighlight, quaffleBall,
    get weather() { return activeWeather; },
    get playerCount() { return riders.length + formationRiders.length; },
    get pixelSize() { return { width: pixelWidth, height: pixelHeight }; }
  };
})();
