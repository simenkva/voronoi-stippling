(() => {
  "use strict";

  const ui = {
    fileInput: document.getElementById("fileInput"),
    btnRun: document.getElementById("btnRun"),
    btnStep: document.getElementById("btnStep"),
    btnReset: document.getElementById("btnReset"),
    btnExportSvg: document.getElementById("btnExportSvg"),
    btnExportPng: document.getElementById("btnExportPng"),
    dots: document.getElementById("dots"),
    iterations: document.getElementById("iterations"),
    samples: document.getElementById("samples"),
    dotSize: document.getElementById("dotSize"),
    gamma: document.getElementById("gamma"),
    maxDim: document.getElementById("maxDim"),
    relax: document.getElementById("relax"),
    invert: document.getElementById("invert"),
    showSource: document.getElementById("showSource"),
    dotsVal: document.getElementById("dotsVal"),
    itersVal: document.getElementById("itersVal"),
    samplesVal: document.getElementById("samplesVal"),
    dotSizeVal: document.getElementById("dotSizeVal"),
    gammaVal: document.getElementById("gammaVal"),
    maxDimVal: document.getElementById("maxDimVal"),
    relaxVal: document.getElementById("relaxVal"),
    stats: document.getElementById("stats"),
    status: document.getElementById("status"),
    sourcePreview: document.getElementById("sourcePreview"),
    view: document.getElementById("view"),
    stage: document.getElementById("stage"),
    stageDrop: document.getElementById("stageDrop"),
    dropCard: document.getElementById("dropCard"),
    dropHint: document.getElementById("dropHint"),
  };

  const previewCtx = ui.sourcePreview.getContext("2d", { willReadFrequently: true });
  const viewCtx = ui.view.getContext("2d");

  const srcCanvas = document.createElement("canvas");
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });

  const state = {
    img: null,
    width: 0,
    height: 0,
    density: null,
    cdf: null,
    totalDensity: 0,
    pointsX: null,
    pointsY: null,
    sumsX: null,
    sumsY: null,
    counts: null,
    iteration: 0,
    running: false,
    targetIterations: 0,
    raf: 0,
    lastStepMs: 0,
  };

  const TAU = Math.PI * 2;

  function setStatus(text, accent = false) {
    ui.status.textContent = text;
    ui.status.style.background = accent ? "rgba(198, 95, 43, 0.12)" : "rgba(31, 106, 95, 0.08)";
    ui.status.style.color = accent ? "#c65f2b" : "#1f6a5f";
  }

  function updateLabels() {
    ui.dotsVal.textContent = ui.dots.value;
    ui.itersVal.textContent = ui.iterations.value;
    ui.samplesVal.textContent = ui.samples.value;
    ui.dotSizeVal.textContent = `${parseFloat(ui.dotSize.value).toFixed(1)}px`;
    ui.gammaVal.textContent = parseFloat(ui.gamma.value).toFixed(2);
    ui.maxDimVal.textContent = `${ui.maxDim.value}px`;
    ui.relaxVal.textContent = parseFloat(ui.relax.value).toFixed(2);
  }

  function drawDemo() {
    const img = new Image();
    img.onload = () => {
      state.img = img;
      rebuildImage();
    };
    img.onerror = () => {
      setStatus("Could not load shaded ball.png", true);
    };
    img.src = "shaded ball.png";
  }

  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        state.img = img;
        rebuildImage();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function rebuildImage() {
    if (!state.img) return;
    const maxDim = parseInt(ui.maxDim.value, 10);
    const { naturalWidth: iw, naturalHeight: ih } = state.img;
    const scale = Math.min(1, maxDim / Math.max(iw, ih));
    state.width = Math.max(1, Math.round(iw * scale));
    state.height = Math.max(1, Math.round(ih * scale));

    srcCanvas.width = state.width;
    srcCanvas.height = state.height;
    srcCtx.clearRect(0, 0, state.width, state.height);
    srcCtx.drawImage(state.img, 0, 0, state.width, state.height);

    ui.view.width = state.width;
    ui.view.height = state.height;

    const previewScale = Math.min(1, 360 / Math.max(state.width, state.height));
    ui.sourcePreview.width = Math.max(1, Math.round(state.width * previewScale));
    ui.sourcePreview.height = Math.max(1, Math.round(state.height * previewScale));
    previewCtx.clearRect(0, 0, ui.sourcePreview.width, ui.sourcePreview.height);
    previewCtx.drawImage(srcCanvas, 0, 0, ui.sourcePreview.width, ui.sourcePreview.height);

    buildDensityMap();
    initPoints();
    draw();
    updateStats();
  }

  function buildDensityMap() {
    const { width: w, height: h } = state;
    if (!w || !h) return;
    const imgData = srcCtx.getImageData(0, 0, w, h).data;
    const n = w * h;
    const density = new Float32Array(n);
    const cdf = new Float64Array(n);
    const gamma = parseFloat(ui.gamma.value);
    const invert = ui.invert.checked;
    let total = 0;

    for (let i = 0; i < n; i++) {
      const idx = i * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      let d = invert ? lum : 1 - lum;
      d = Math.pow(Math.max(0, d), gamma);
      density[i] = d;
      total += d;
      cdf[i] = total;
    }

    if (total <= 1e-6) {
      total = n;
      for (let i = 0; i < n; i++) {
        density[i] = 1;
        cdf[i] = i + 1;
      }
    }

    state.density = density;
    state.cdf = cdf;
    state.totalDensity = total;
  }

  function sampleFromDensity() {
    const w = state.width;
    const h = state.height;
    const total = state.totalDensity;
    if (total <= 0) {
      return [Math.random() * w, Math.random() * h];
    }
    const target = Math.random() * total;
    let lo = 0;
    let hi = state.cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (state.cdf[mid] < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const idx = lo;
    const x = (idx % w) + Math.random();
    const y = Math.floor(idx / w) + Math.random();
    return [x, y];
  }

  function initPoints() {
    const n = parseInt(ui.dots.value, 10);
    state.pointsX = new Float32Array(n);
    state.pointsY = new Float32Array(n);
    state.sumsX = new Float32Array(n);
    state.sumsY = new Float32Array(n);
    state.counts = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const [x, y] = sampleFromDensity();
      state.pointsX[i] = x;
      state.pointsY[i] = y;
    }
    state.iteration = 0;
  }

  function stepIteration() {
    const n = state.pointsX.length;
    if (!n) return;
    const samplesPerDot = parseInt(ui.samples.value, 10);
    const maxSamples = 220000;
    const samples = Math.min(maxSamples, Math.max(2000, samplesPerDot * n));
    state.sumsX.fill(0);
    state.sumsY.fill(0);
    state.counts.fill(0);

    const ptsX = state.pointsX;
    const ptsY = state.pointsY;
    const sumsX = state.sumsX;
    const sumsY = state.sumsY;
    const counts = state.counts;

    for (let s = 0; s < samples; s++) {
      const [x, y] = sampleFromDensity();
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < n; i++) {
        const dx = x - ptsX[i];
        const dy = y - ptsY[i];
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      sumsX[best] += x;
      sumsY[best] += y;
      counts[best] += 1;
    }

    const relax = parseFloat(ui.relax.value);
    for (let i = 0; i < n; i++) {
      if (counts[i] > 0) {
        const nx = sumsX[i] / counts[i];
        const ny = sumsY[i] / counts[i];
        ptsX[i] = ptsX[i] + (nx - ptsX[i]) * relax;
        ptsY[i] = ptsY[i] + (ny - ptsY[i]) * relax;
      } else {
        const [x, y] = sampleFromDensity();
        ptsX[i] = x;
        ptsY[i] = y;
      }
    }
    state.iteration += 1;
  }

  function draw() {
    const w = state.width;
    const h = state.height;
    if (!w || !h) return;
    viewCtx.clearRect(0, 0, w, h);
    viewCtx.fillStyle = "#ffffff";
    viewCtx.fillRect(0, 0, w, h);

    if (ui.showSource.checked) {
      viewCtx.globalAlpha = 0.35;
      viewCtx.drawImage(srcCanvas, 0, 0, w, h);
      viewCtx.globalAlpha = 1;
    }

    const r = parseFloat(ui.dotSize.value) * 0.5;
    viewCtx.fillStyle = "#111111";
    viewCtx.beginPath();
    for (let i = 0; i < state.pointsX.length; i++) {
      const x = state.pointsX[i];
      const y = state.pointsY[i];
      viewCtx.moveTo(x + r, y);
      viewCtx.arc(x, y, r, 0, TAU);
    }
    viewCtx.fill();
  }

  function updateStats() {
    const n = state.pointsX ? state.pointsX.length : 0;
    const total = state.totalDensity || 0;
    const dims = state.width && state.height ? `${state.width}×${state.height}` : "-";
    const ms = state.lastStepMs ? `${state.lastStepMs.toFixed(1)}ms/iter` : "-";
    ui.stats.textContent = `Points: ${n} | Iter: ${state.iteration} | Samples: ${ui.samples.value}/dot | Size: ${dims} | Density sum: ${total.toFixed(1)} | ${ms}`;
  }

  function runLoop() {
    if (!state.running) return;
    const t0 = performance.now();
    stepIteration();
    draw();
    state.lastStepMs = performance.now() - t0;
    updateStats();

    if (state.iteration >= state.targetIterations) {
      state.running = false;
      setStatus(`Complete at ${state.iteration} iterations`, false);
      ui.btnRun.textContent = "Run";
      return;
    }
    state.raf = requestAnimationFrame(runLoop);
  }

  function startRun() {
    if (!state.pointsX) return;
    if (state.running) {
      state.running = false;
      ui.btnRun.textContent = "Run";
      setStatus("Paused", true);
      return;
    }
    state.targetIterations = state.iteration + parseInt(ui.iterations.value, 10);
    state.running = true;
    ui.btnRun.textContent = "Pause";
    setStatus("Relaxing...", false);
    state.raf = requestAnimationFrame(runLoop);
  }

  function stepOnce() {
    if (!state.pointsX) return;
    const t0 = performance.now();
    stepIteration();
    draw();
    state.lastStepMs = performance.now() - t0;
    updateStats();
    setStatus(`Step ${state.iteration}`, false);
  }

  function resetPoints() {
    if (!state.img) return;
    buildDensityMap();
    initPoints();
    draw();
    updateStats();
    setStatus("Reset points", true);
  }

  function exportSvg() {
    if (!state.pointsX || !state.width) return;
    const w = state.width;
    const h = state.height;
    const r = parseFloat(ui.dotSize.value) * 0.5;
    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n`;
    svg += `<g fill="#111111" stroke="none">\n`;
    for (let i = 0; i < state.pointsX.length; i++) {
      const x = state.pointsX[i].toFixed(2);
      const y = state.pointsY[i].toFixed(2);
      svg += `<circle cx="${x}" cy="${y}" r="${r.toFixed(2)}" />\n`;
    }
    svg += `</g>\n</svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml" });
    downloadBlob(blob, "stippling.svg");
  }

  function exportPng() {
    ui.view.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, "stippling.png");
    });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function attachDragTargets(targets) {
    targets.forEach((target) => {
      target.addEventListener("dragover", (e) => {
        e.preventDefault();
        ui.stageDrop.classList.add("active");
        ui.dropHint.classList.add("active");
      });
      target.addEventListener("dragleave", () => {
        ui.stageDrop.classList.remove("active");
        ui.dropHint.classList.remove("active");
      });
      target.addEventListener("drop", (e) => {
        e.preventDefault();
        ui.stageDrop.classList.remove("active");
        ui.dropHint.classList.remove("active");
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      });
    });
  }

  function refreshDensityAndDraw() {
    if (!state.img) return;
    buildDensityMap();
    initPoints();
    draw();
    updateStats();
  }

  function init() {
    updateLabels();
    setStatus("Idle", false);
    ui.fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));

    ui.btnRun.addEventListener("click", startRun);
    ui.btnStep.addEventListener("click", stepOnce);
    ui.btnReset.addEventListener("click", resetPoints);
    ui.btnExportSvg.addEventListener("click", exportSvg);
    ui.btnExportPng.addEventListener("click", exportPng);

    ui.dots.addEventListener("input", () => {
      updateLabels();
    });
    ui.dots.addEventListener("change", () => {
      if (!state.img) return;
      initPoints();
      draw();
      updateStats();
    });
    ui.iterations.addEventListener("input", updateLabels);
    ui.samples.addEventListener("input", updateLabels);
    ui.dotSize.addEventListener("input", () => {
      updateLabels();
      draw();
    });
    ui.gamma.addEventListener("input", () => {
      updateLabels();
    });
    ui.gamma.addEventListener("change", refreshDensityAndDraw);
    ui.relax.addEventListener("input", updateLabels);
    ui.maxDim.addEventListener("input", updateLabels);
    ui.maxDim.addEventListener("change", rebuildImage);
    ui.invert.addEventListener("change", refreshDensityAndDraw);
    ui.showSource.addEventListener("change", draw);

    attachDragTargets([ui.stage, ui.dropCard]);
    drawDemo();
  }

  init();
})();
