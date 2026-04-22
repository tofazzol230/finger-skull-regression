const $ = (id) => document.getElementById(id);

const sample = {
  finger: [
    9.1, 7.9, 8.2, 8.1, 8.4, 7.9, 7.7, 8.2, 7.9, 7.9,
    7.8, 8.3, 8.1, 8.1, 8.2, 8.0, 7.7, 7.9, 8.6, 8.4,
  ],
  skull: [
    53.5, 57.7, 56.8, 56.3, 57.2, 60.7, 56.2, 56.8, 57.7, 60.7,
    56.6, 59.2, 53.5, 60.7, 56.8, 57.9, 52.7, 55.4, 55.1, 57.2,
  ],
};

function formatList(arr) {
  return arr.map((v) => Number(v).toString()).join(", ");
}

function parseNumberList(text) {
  const matches = text
    .replace(/\s+/g, " ")
    .match(/-?\d+(?:\.\d+)?/g);
  if (!matches) return [];
  return matches.map(Number).filter((n) => Number.isFinite(n));
}

function tryParseFromRawSnippet(text) {
  const fingerMatch = text.match(/finger_values\s*=\s*\[([\s\S]*?)\]/i);
  const skullMatch = text.match(/skull_values\s*=\s*\[([\s\S]*?)\]/i);
  if (!fingerMatch || !skullMatch) return null;
  const finger = parseNumberList(fingerMatch[1]);
  const skull = parseNumberList(skullMatch[1]);
  if (!finger.length || !skull.length) return null;
  return { finger, skull };
}

function normalizeFinger(x) {
  if (!Number.isFinite(x)) return x;
  if (x >= 100) return x / 100;
  if (x >= 20) return x / 10;
  return x;
}

function normalizeSkull(y) {
  if (!Number.isFinite(y)) return y;
  if (y >= 1000) return y / 100;
  if (y >= 200) return y / 10;
  return y;
}

function tCriticalApprox(confidence, df) {
  // Two-tailed: alpha = 1-confidence; need quantile(1-alpha/2).
  // Uses a standard series expansion from the normal quantile (good for df >= ~3).
  const z = confidence === 0.9 ? 1.6448536269514722 : confidence === 0.99 ? 2.5758293035489004 : 1.959963984540054;
  if (df <= 0) return NaN;
  const z2 = z * z;
  const z3 = z2 * z;
  const z5 = z3 * z2;
  const z7 = z5 * z2;

  const df1 = df;
  // t ≈ z + (z^3+z)/(4df) + (5z^5+16z^3+3z)/(96df^2) + (3z^7+19z^5+17z^3-15z)/(384df^3)
  const t =
    z +
    (z3 + z) / (4 * df1) +
    (5 * z5 + 16 * z3 + 3 * z) / (96 * df1 * df1) +
    (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df1 * df1 * df1);

  return t;
}

function computeRegression(x, y, predictionAt, confidence) {
  const n = Math.min(x.length, y.length);
  if (n < 3) throw new Error("Need at least 3 (x,y) pairs.");

  let sumX = 0,
    sumY = 0,
    sumXX = 0,
    sumYY = 0,
    sumXY = 0;

  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    sumX += xi;
    sumY += yi;
    sumXX += xi * xi;
    sumYY += yi * yi;
    sumXY += xi * yi;
  }

  const Sxx = sumXX - (sumX * sumX) / n;
  const Syy = sumYY - (sumY * sumY) / n;
  const Sxy = sumXY - (sumX * sumY) / n;

  if (Sxx === 0) throw new Error("Sxx is 0 (all X values identical). Cannot fit regression.");

  const B1 = Sxy / Sxx;
  const B0 = (sumY - B1 * sumX) / n;

  const SSE = Syy - B1 * Sxy;
  const df = n - 2;
  const errorVar = SSE / df;

  const SE_B1 = Math.sqrt(errorVar / Sxx);
  const xBar = sumX / n;
  const SE_B0 = Math.sqrt(errorVar * (1 / n + (xBar * xBar) / Sxx));

  const SE_at = Math.sqrt(errorVar * (1 / n + ((predictionAt - xBar) ** 2) / Sxx));

  const tCrit = tCriticalApprox(confidence, df);

  const yHat = B0 + B1 * predictionAt;
  const CI_prediction = [yHat - tCrit * SE_at, yHat + tCrit * SE_at];

  const tStat = B1 / SE_B1;
  const CI_slope = [B1 - tCrit * SE_B1, B1 + tCrit * SE_B1];

  const R2 = Syy === 0 ? NaN : 1 - SSE / Syy;

  return {
    n,
    sumX,
    sumY,
    sumXX,
    sumYY,
    sumXY,
    Sxx,
    Syy,
    Sxy,
    B0,
    B1,
    SSE,
    df,
    errorVar,
    SE_B0,
    SE_B1,
    predictionAt,
    yHat,
    SE_at,
    tCrit,
    CI_prediction,
    tStat,
    CI_slope,
    R2,
  };
}

function setError(msg) {
  const el = $("inputError");
  if (!msg) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function drawPlot(x, y, r) {
  const canvas = $("plot");
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = cssW;
  const H = cssH;

  ctx.clearRect(0, 0, W, H);

  const pad = { l: 52, r: 16, t: 18, b: 44 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const xmin = Math.min(...x);
  const xmax = Math.max(...x);
  const ymin = Math.min(...y);
  const ymax = Math.max(...y);

  const xPad = (xmax - xmin) * 0.08 || 1;
  const yPad = (ymax - ymin) * 0.08 || 1;

  const X0 = xmin - xPad;
  const X1 = xmax + xPad;
  const Y0 = ymin - yPad;
  const Y1 = ymax + yPad;

  const xToPx = (v) => pad.l + ((v - X0) / (X1 - X0)) * plotW;
  const yToPx = (v) => pad.t + plotH - ((v - Y0) / (Y1 - Y0)) * plotH;

  // background
  ctx.fillStyle = "rgba(10,15,34,.35)";
  ctx.fillRect(pad.l, pad.t, plotW, plotH);

  // axes
  ctx.strokeStyle = "rgba(255,255,255,.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + plotH);
  ctx.lineTo(pad.l + plotW, pad.t + plotH);
  ctx.stroke();

  // ticks
  ctx.fillStyle = "rgba(255,255,255,.65)";
  ctx.font = "12px system-ui";
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const tx = X0 + (i / ticks) * (X1 - X0);
    const px = xToPx(tx);
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(px, pad.t);
    ctx.lineTo(px, pad.t + plotH);
    ctx.stroke();
    ctx.fillText(tx.toFixed(2), px - 14, pad.t + plotH + 18);
  }
  for (let i = 0; i <= ticks; i++) {
    const ty = Y0 + (i / ticks) * (Y1 - Y0);
    const py = yToPx(ty);
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(pad.l, py);
    ctx.lineTo(pad.l + plotW, py);
    ctx.stroke();
    ctx.fillText(ty.toFixed(1), 8, py + 4);
  }

  // points
  ctx.fillStyle = "rgba(122,162,255,.9)";
  for (let i = 0; i < x.length; i++) {
    const px = xToPx(x[i]);
    const py = yToPx(y[i]);
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // regression line
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = 2;
  const lx0 = X0;
  const lx1 = X1;
  const ly0 = r.B0 + r.B1 * lx0;
  const ly1 = r.B0 + r.B1 * lx1;
  ctx.beginPath();
  ctx.moveTo(xToPx(lx0), yToPx(ly0));
  ctx.lineTo(xToPx(lx1), yToPx(ly1));
  ctx.stroke();

  // prediction marker + CI bar
  const px0 = xToPx(r.predictionAt);
  const pyHat = yToPx(r.yHat);
  ctx.strokeStyle = "rgba(255,107,107,.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px0, pad.t);
  ctx.lineTo(px0, pad.t + plotH);
  ctx.stroke();

  const [ciLo, ciHi] = r.CI_prediction;
  ctx.strokeStyle = "rgba(255,107,107,.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px0, yToPx(ciLo));
  ctx.lineTo(px0, yToPx(ciHi));
  ctx.stroke();

  ctx.fillStyle = "rgba(255,107,107,1)";
  ctx.beginPath();
  ctx.arc(px0, pyHat, 4, 0, Math.PI * 2);
  ctx.fill();

  // labels
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.font = "13px system-ui";
  ctx.fillText("Finger (X)", pad.l + plotW / 2 - 32, H - 12);
  ctx.save();
  ctx.translate(14, pad.t + plotH / 2 + 32);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Skull (Y)", 0, 0);
  ctx.restore();
}

function renderResults(r, x, y) {
  $("resultsEmpty").hidden = true;
  $("results").hidden = false;

  const fx = (n) => (Number.isFinite(n) ? n.toFixed(6) : String(n));

  $("outSummary").textContent =
    `n = ${r.n}\n` +
    `x̄ = ${fx(r.sumX / r.n)}, ȳ = ${fx(r.sumY / r.n)}\n` +
    `df = ${r.df}, t* ≈ ${fx(r.tCrit)} (two-tailed)`;

  $("outTotals").textContent =
    `Σx = ${fx(r.sumX)}\n` +
    `Σy = ${fx(r.sumY)}\n` +
    `Σx² = ${fx(r.sumXX)}\n` +
    `Σy² = ${fx(r.sumYY)}\n` +
    `Σxy = ${fx(r.sumXY)}`;

  $("outS").textContent = `Sxx = ${fx(r.Sxx)}\nSyy = ${fx(r.Syy)}\nSxy = ${fx(r.Sxy)}`;

  $("outModel").textContent =
    `B1 (slope) = ${fx(r.B1)}\n` +
    `B0 (intercept) = ${fx(r.B0)}\n\n` +
    `Fitted model: ŷ = ${fx(r.B0)} + ${fx(r.B1)}x\n\n` +
    `SSE = ${fx(r.SSE)}\n` +
    `Error variance (s²) = ${fx(r.errorVar)}\n` +
    `SE(B1) = ${fx(r.SE_B1)}\n` +
    `SE(B0) = ${fx(r.SE_B0)}`;

  $("outPrediction").textContent =
    `At x0 = ${r.predictionAt}:\n` +
    `ŷ(x0) = ${fx(r.yHat)}\n` +
    `SE at x0 = ${fx(r.SE_at)}\n\n` +
    `${Math.round(Number($("confidence").value) * 100)}% CI: [${fx(r.CI_prediction[0])}, ${fx(r.CI_prediction[1])}]`;

  const significant = Math.abs(r.tStat) > r.tCrit;
  $("outInference").textContent =
    `t-statistic for slope = ${fx(r.tStat)}\n` +
    `Decision: ${significant ? "Significant" : "Not significant"} (|t| ${significant ? ">" : "≤"} t*)\n\n` +
    `${Math.round(Number($("confidence").value) * 100)}% CI for slope: [${fx(r.CI_slope[0])}, ${fx(r.CI_slope[1])}]\n` +
    `R² = ${fx(r.R2)}`;

  drawPlot(x, y, r);
}

function loadSample() {
  $("fingerValues").value = formatList(sample.finger);
  $("skullValues").value = formatList(sample.skull);
  $("predictionAt").value = "8.7";
}

function wire() {
  loadSample();

  $("btnLoadSample").onclick = () => {
    loadSample();
    setError(null);
  };

  $("btnClear").onclick = () => {
    $("fingerValues").value = "";
    $("skullValues").value = "";
    setError(null);
  };

  $("btnCompute").onclick = () => {
    try {
      setError(null);

      // Allow pasting a full python snippet into either box.
      const raw = $("fingerValues").value + "\n" + $("skullValues").value;
      const parsed = tryParseFromRawSnippet(raw);

      const finger = parsed ? parsed.finger : parseNumberList($("fingerValues").value);
      const skull = parsed ? parsed.skull : parseNumberList($("skullValues").value);

      if (!finger.length || !skull.length) throw new Error("Please provide both finger and skull values.");
      if (finger.length !== skull.length) throw new Error(`Counts differ: finger=${finger.length}, skull=${skull.length}.`);

      const predictionAt = Number($("predictionAt").value);
      if (!Number.isFinite(predictionAt)) throw new Error("Invalid prediction X value.");

      const confidence = Number($("confidence").value);
      const r = computeRegression(finger, skull, predictionAt, confidence);
      renderResults(r, finger, skull);
    } catch (e) {
      setError(e?.message || String(e));
    }
  };


}

wire();
