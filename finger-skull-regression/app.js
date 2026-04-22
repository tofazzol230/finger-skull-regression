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

function fixOCRDigits(s) {
  // Common OCR confusions for digits in screenshots.
  return String(s)
    .replace(/[Tt]/g, "7")
    .replace(/[Ss]/g, "5")
    .replace(/[Oo]/g, "0")
    .replace(/[Il]/g, "1")
    .replace(/B/g, "8")
    .replace(/Z/g, "2");
}

function parseOCRFloat(s) {
  const cleaned = fixOCRDigits(s).replace(/[^0-9,.-]/g, "").replace(/,(?=\d)/g, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function parseTableLikeOCR(text, swap = false) {
  // More tolerant parser for OCR output. Handles:
  // - two rows per line
  // - comma decimals
  // - squashed tokens like "482 588" => id=4, finger=82, skull=588
  // - OCR letters in numbers like "T9" => "79"
  // swap=true means table is: id skull finger (columns swapped)
  const triples = [];

  for (const line of text.split(/\r?\n/)) {
    const tokens = (line.match(/[A-Za-z]*-?\d+(?:[\.,]\d+)?/g) || []).map(fixOCRDigits);
    if (!tokens.length) continue;

    let i = 0;
    while (i < tokens.length) {
      const t0 = tokens[i];

      // Heuristic: "482 588" means id=4, finger=82, skull=588.
      if (!swap && /^\d{3}$/.test(t0) && i + 1 < tokens.length) {
        const id = Number(t0[0]);
        const fingerRaw = Number(t0.slice(1));
        const skullRaw = parseOCRFloat(tokens[i + 1]);

        const finger = normalizeFinger(fingerRaw);
        const skull = normalizeSkull(skullRaw);

        if (
          Number.isFinite(id) &&
          Number.isFinite(finger) &&
          Number.isFinite(skull) &&
          finger >= 1 &&
          finger <= 30 &&
          skull >= 20 &&
          skull <= 500
        ) {
          triples.push({ id, finger, skull });
          i += 2;
          continue;
        }
      }

      if (i + 2 < tokens.length) {
        const idRaw = parseOCRFloat(t0);
        const id = Number.isFinite(idRaw) ? Math.trunc(idRaw) : NaN;

        if (Number.isFinite(id) && idRaw === id) {
          const a = parseOCRFloat(tokens[i + 1]);
          const b = parseOCRFloat(tokens[i + 2]);

          const finger = normalizeFinger(swap ? b : a);
          const skull = normalizeSkull(swap ? a : b);

          if (
            Number.isFinite(finger) &&
            Number.isFinite(skull) &&
            finger >= 1 &&
            finger <= 30 &&
            skull >= 20 &&
            skull <= 500
          ) {
            triples.push({ id, finger, skull });
            i += 3;
            continue;
          }
        }
      }

      i += 1;
    }
  }

  triples.sort((a, b) => a.id - b.id);

  const seen = new Set();
  const ordered = [];
  for (const t of triples) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    ordered.push(t);
  }

  const finger = ordered.map((t) => t.finger).filter((n) => Number.isFinite(n));
  const skull = ordered.map((t) => t.skull).filter((n) => Number.isFinite(n));
  if (finger.length && finger.length === skull.length) return { finger, skull };
  return null;
}

function parsePairsLikeOCR(text, swap = false) {
  // Fallback: parse pairs per line (finger skull). swap=true means each pair is skull finger.
  const finger = [];
  const skull = [];
  for (const line of text.split(/\r?\n/)) {
    const nums = (line.match(/[A-Za-z]*-?\d+(?:[\.,]\d+)?/g) || []).map(parseOCRFloat).filter(Number.isFinite);
    if (nums.length < 2) continue;

    // If line looks like: id + pairs..., drop the first.
    if (nums.length >= 3 && nums.length % 2 === 1) {
      for (let i = 1; i + 1 < nums.length; i += 2) {
        const a = nums[i];
        const b = nums[i + 1];
        finger.push(normalizeFinger(swap ? b : a));
        skull.push(normalizeSkull(swap ? a : b));
      }
      continue;
    }

    if (nums.length % 3 === 0 && nums.length >= 3) {
      for (let i = 0; i + 2 < nums.length; i += 3) {
        const a = nums[i + 1];
        const b = nums[i + 2];
        finger.push(normalizeFinger(swap ? b : a));
        skull.push(normalizeSkull(swap ? a : b));
      }
      continue;
    }

    for (let i = 0; i + 1 < nums.length; i += 2) {
      const a = nums[i];
      const b = nums[i + 1];
      finger.push(normalizeFinger(swap ? b : a));
      skull.push(normalizeSkull(swap ? a : b));
    }
  }

  if (finger.length && finger.length === skull.length) return { finger, skull };
  return null;
}

function scoreParsed(p) {
  if (!p || !Array.isArray(p.finger) || !Array.isArray(p.skull)) return -Infinity;
  if (!p.finger.length || p.finger.length !== p.skull.length) return -Infinity;

  let score = p.finger.length * 10;
  let good = 0;
  let bad = 0;

  for (let i = 0; i < p.finger.length; i++) {
    const x = p.finger[i];
    const y = p.skull[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      bad++;
      continue;
    }

    // broad plausibility windows after normalization
    const okX = x > 0.2 && x < 50;
    const okY = y > 1 && y < 1000;
    const likelyX = x >= 1 && x <= 30;
    const likelyY = y >= 20 && y <= 500;

    if (okX && okY) good++;
    if (likelyX) score += 2;
    if (likelyY) score += 2;
    if (!okX) score -= 4;
    if (!okY) score -= 4;
  }

  score += good * 2 - bad * 6;
  return score;
}

function bestParseFromText(text) {
  const candidates = [];

  const fromSnippet = tryParseFromRawSnippet(text);
  if (fromSnippet) candidates.push(fromSnippet);

  const t1 = parseTableLikeOCR(text, false);
  if (t1) candidates.push(t1);
  const t2 = parseTableLikeOCR(text, true);
  if (t2) candidates.push(t2);

  const p1 = parsePairsLikeOCR(text, false);
  if (p1) candidates.push(p1);
  const p2 = parsePairsLikeOCR(text, true);
  if (p2) candidates.push(p2);

  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = scoreParsed(c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }

  if (best && bestScore > 25) return best; // require a minimum confidence
  return null;
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

async function preprocessToCanvas(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();

  const canvas = $("workCanvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const maxW = 1400;
  const scale = Math.min(1, maxW / img.width);
  canvas.width = Math.floor(img.width * scale);
  canvas.height = Math.floor(img.height * scale);

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function makeHighContrastBWCanvas(srcCanvas) {
  const canvas = document.createElement("canvas");
  canvas.width = srcCanvas.width;
  canvas.height = srcCanvas.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(srcCanvas, 0, 0);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const avg = sum / (data.length / 4);
  const thr = Math.min(200, Math.max(120, avg * 0.9));

  for (let i = 0; i < data.length; i += 4) {
    let v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    v = v > thr ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);

  return canvas;
}

function scoreOCRText(text) {
  return (text.match(/-?\d+(?:[\.,]\d+)?/g) || []).length;
}

async function recognizeCanvas(canvas, label) {
  const { data } = await window.Tesseract.recognize(canvas, "eng", {
    logger: (m) => {
      if (m.status) {
        const pct = m.progress != null ? ` ${(m.progress * 100).toFixed(0)}%` : "";
        $("ocrStatus").textContent = `${label}: ${m.status}${pct}`;
      }
    },
  });
  return data.text || "";
}

async function runOCR(file) {
  if (!window.Tesseract) throw new Error("Tesseract.js not loaded.");

  const base = await preprocessToCanvas(file);
  const textRaw = await recognizeCanvas(base, "OCR (raw)");
  if (maybeAutofillFromText(textRaw)) return textRaw;

  const bw = makeHighContrastBWCanvas(base);
  const textBW = await recognizeCanvas(bw, "OCR (contrast)");

  return scoreOCRText(textBW) > scoreOCRText(textRaw) ? textBW : textRaw;
}

function maybeAutofillFromText(text) {
  return bestParseFromText(text);
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

  $("imageInput").onchange = (e) => {
    const file = e.target.files?.[0];
    $("btnOCR").disabled = !file;
    $("ocrStatus").textContent = "";
    $("ocrText").value = "";

    if (!file) {
      $("preview").hidden = true;
      return;
    }

    $("preview").hidden = false;
    $("previewImg").src = URL.createObjectURL(file);
  };

  $("btnOCR").onclick = async () => {
    const file = $("imageInput").files?.[0];
    if (!file) return;

    $("btnOCR").disabled = true;
    $("ocrStatus").textContent = "Starting OCR...";

    try {
      const text = await runOCR(file);
      $("ocrText").value = text;

      const parsed = maybeAutofillFromText(text);
      if (!parsed) throw new Error("Could not confidently parse finger/skull values from OCR text.");

      $("fingerValues").value = formatList(parsed.finger);
      $("skullValues").value = formatList(parsed.skull);

      $("ocrStatus").textContent = `Extracted ${parsed.finger.length} rows.`;
    } catch (e) {
      $("ocrStatus").textContent = "";
      setError(e?.message || String(e));
    } finally {
      $("btnOCR").disabled = false;
    }
  };
}

wire();
