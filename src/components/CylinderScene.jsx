import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Desenha uma imagem dentro de um canvas usando "cover" ou "contain"
 * e alinhamentos (cx, cy) onde 0..1 (0=esquerda/topo, 0.5=center, 1=direita/baixo).
 */
function drawImageWithFit(ctx, img, cw, ch, fit = "cover", cx = 0.5, cy = 0.5) {
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;

  if (!iw || !ih) return;

  const scale =
    fit === "contain"
      ? Math.min(cw / iw, ch / ih)
      : Math.max(cw / iw, ch / ih);

  const sw = iw * scale;
  const sh = ih * scale;

  // offset para alinhamento (cx/cy)
  const ox = (cw - sw) * cx;
  const oy = (ch - sh) * cy;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, ox, oy, sw, sh);
}

export default function CylinderScene() {
  const containerRef = useRef(null);

  // UI state
  const [fitMode, setFitMode] = useState("cover"); // cover | contain
  const [labelWidth, setLabelWidth] = useState(1.0); // 0.1..1.0 (fração da volta)
  const [labelHeight, setLabelHeight] = useState(1.0); // 0.1..1.0 (fração da altura)
  const [offsetX, setOffsetX] = useState(0.0); // -0.5..0.5 (em UV)
  const [offsetY, setOffsetY] = useState(0.0); // -0.5..0.5 (em UV)
  const [rotDeg, setRotDeg] = useState(0); // graus

  // refs para objetos three
  const threeRef = useRef({
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    material: null,
    texture: null,
    textureCanvas: null,
    textureCtx: null,
    img: null,
    raf: 0,
    onResize: null,
    domCanvas: null,
  });

  // aplica parâmetros UV no material/texture
  const applyTextureParams = () => {
    const { texture } = threeRef.current;
    if (!texture) return;

    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    // labelWidth controla quantos % da circunferência a imagem ocupa
    texture.repeat.set(clamp(labelWidth, 0.05, 1.0), clamp(labelHeight, 0.05, 1.0));

    // centraliza por padrão e aplica offsets finos
    // Quando repeat < 1, o "rótulo" fica numa parte do cilindro.
    // offsetX/Y deslocam a área visível.
    texture.offset.set(
      0.5 - texture.repeat.x / 2 + offsetX,
      0.5 - texture.repeat.y / 2 + offsetY
    );

    texture.center.set(0.5, 0.5);
    texture.rotation = THREE.MathUtils.degToRad(rotDeg);

    texture.needsUpdate = true;
  };

  // redesenha o canvas de textura com base na imagem e no fitMode
  const redrawTextureCanvas = () => {
    const { textureCanvas, textureCtx, img, texture } = threeRef.current;
    if (!textureCanvas || !textureCtx || !texture) return;

    // Se não tiver imagem, desenha placeholder
    if (!img) {
      const cw = textureCanvas.width;
      const ch = textureCanvas.height;

      textureCtx.clearRect(0, 0, cw, ch);
      textureCtx.fillStyle = "#ffffff";
      textureCtx.fillRect(0, 0, cw, ch);

      textureCtx.fillStyle = "rgba(0,0,0,0.10)";
      for (let x = 0; x < cw; x += 64) textureCtx.fillRect(x, 0, 2, ch);

      textureCtx.fillStyle = "#333";
      textureCtx.font = "64px system-ui, Arial";
      textureCtx.textAlign = "center";
      textureCtx.textBaseline = "middle";
      textureCtx.fillText("ENVIE UMA IMAGEM", cw / 2, ch / 2);

      texture.needsUpdate = true;
      return;
    }

    drawImageWithFit(
      textureCtx,
      img,
      textureCanvas.width,
      textureCanvas.height,
      fitMode,
      0.5,
      0.5
    );

    texture.needsUpdate = true;
  };

  // inicia three
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // --- Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    // --- Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(2.5, 1.6, 3.2);

    // --- Force WebGL1 context (evita WebGL2)
    const domCanvas = document.createElement("canvas");
    container.appendChild(domCanvas);

    const gl = domCanvas.getContext("webgl", {
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });

    if (!gl) {
      const msg = document.createElement("div");
      msg.style.cssText =
        "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
        "color:white;font-family:system-ui;background:#111;padding:24px;text-align:center;";
      msg.innerHTML =
        "Não foi possível criar contexto <b>WebGL</b> (WebGL1).<br/>Verifique aceleração de hardware / driver de vídeo.";
      container.appendChild(msg);

      container.removeChild(domCanvas);
      return;
    }

    // --- Renderer (usando WebGL1) - Three r162
    const renderer = new THREE.WebGLRenderer({
      canvas: domCanvas,
      context: gl,
      antialias: true,
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // --- Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // --- Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.9);
    scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(4, 6, 3);
    scene.add(dir);

    // --- Texture Canvas (onde desenhamos imagem/placeholder)
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 2048;
    textureCanvas.height = 1024;
    const textureCtx = textureCanvas.getContext("2d");

    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    // desenha placeholder inicial
    const cw = textureCanvas.width;
    const ch = textureCanvas.height;
    textureCtx.fillStyle = "#ffffff";
    textureCtx.fillRect(0, 0, cw, ch);
    textureCtx.fillStyle = "rgba(0,0,0,0.10)";
    for (let x = 0; x < cw; x += 64) textureCtx.fillRect(x, 0, 2, ch);
    textureCtx.fillStyle = "#333";
    textureCtx.font = "64px system-ui, Arial";
    textureCtx.textAlign = "center";
    textureCtx.textBaseline = "middle";
    textureCtx.fillText("ENVIE UMA IMAGEM", cw / 2, ch / 2);
    texture.needsUpdate = true;

    // --- Cylinder
    const geometry = new THREE.CylinderGeometry(1, 1, 2, 96, 1, true);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffffff,
      roughness: 0.7,
      metalness: 0.0,
    });

    const cylinder = new THREE.Mesh(geometry, material);
    scene.add(cylinder);

    // --- Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.05;
    scene.add(ground);

    // --- Resize
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    // --- Animate
    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    // guarda refs
    threeRef.current = {
      renderer,
      scene,
      camera,
      controls,
      material,
      texture,
      textureCanvas,
      textureCtx,
      img: null,
      raf,
      onResize,
      domCanvas,
    };

    // aplica parâmetros iniciais
    applyTextureParams();

    // cleanup
    return () => {
      cancelAnimationFrame(threeRef.current.raf);
      window.removeEventListener("resize", onResize);

      controls.dispose();
      geometry.dispose();
      material.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
      texture.dispose();

      renderer.dispose();

      if (domCanvas.parentNode === container) container.removeChild(domCanvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sempre que parâmetros mudarem, aplica UV
  useEffect(() => {
    applyTextureParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelWidth, labelHeight, offsetX, offsetY, rotDeg]);

  // sempre que fit mudar, redesenha canvas
  useEffect(() => {
    redrawTextureCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMode]);

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      threeRef.current.img = img;
      redrawTextureCanvas();
      applyTextureParams();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  const reset = () => {
    setFitMode("cover");
    setLabelWidth(1.0);
    setLabelHeight(1.0);
    setOffsetX(0.0);
    setOffsetY(0.0);
    setRotDeg(0);
    threeRef.current.img = null;
    redrawTextureCanvas();
    applyTextureParams();
  };

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 10,
          width: 340,
          background: "rgba(0,0,0,0.55)",
          padding: 12,
          borderRadius: 10,
          color: "#eee",
          fontFamily: "system-ui, Arial",
          fontSize: 12,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="file" accept="image/*" onChange={onFileChange} />
          <button onClick={reset} style={{ padding: "6px 10px", cursor: "pointer" }}>
            Reset
          </button>
        </div>

        <div style={{ marginTop: 10 }}>
          <div style={{ marginBottom: 6 }}>Fit da imagem</div>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name="fit"
                value="cover"
                checked={fitMode === "cover"}
                onChange={() => setFitMode("cover")}
              />
              Cover
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="radio"
                name="fit"
                value="contain"
                checked={fitMode === "contain"}
                onChange={() => setFitMode("contain")}
              />
              Contain
            </label>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div>Rótulo: largura (volta do cilindro) — {Math.round(labelWidth * 100)}%</div>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.01"
            value={labelWidth}
            onChange={(e) => setLabelWidth(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <div>Rótulo: altura — {Math.round(labelHeight * 100)}%</div>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.01"
            value={labelHeight}
            onChange={(e) => setLabelHeight(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <div>Offset X — {offsetX.toFixed(3)}</div>
          <input
            type="range"
            min="-0.5"
            max="0.5"
            step="0.001"
            value={offsetX}
            onChange={(e) => setOffsetX(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <div>Offset Y — {offsetY.toFixed(3)}</div>
          <input
            type="range"
            min="-0.5"
            max="0.5"
            step="0.001"
            value={offsetY}
            onChange={(e) => setOffsetY(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <div>Rotação — {rotDeg}°</div>
          <input
            type="range"
            min="-180"
            max="180"
            step="0.1"
            value={rotDeg}
            onChange={(e) => setRotDeg(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ marginTop: 10, opacity: 0.85, lineHeight: 1.35 }}>
          Dica: use <b>Cover</b> para “preencher” o rótulo. Use <b>Contain</b> para não cortar a imagem.
        </div>
      </div>
    </div>
  );
}
