import { useCallback, useEffect, useRef, useState } from "react";
import { generatePinyin } from "./lib/pinyin";
import { pinyin } from "pinyin-pro";

function splitPinyin(hanzi) {
  try {
    return pinyin(hanzi, { toneType: "symbol", type: "array" });
  } catch {
    return hanzi.split("").map((c) => generatePinyin(c));
  }
}

// ── Recognition helpers ──

const GRID = 40; // higher resolution for better accuracy
const DILATE_R = 1; // tighter dilation = stricter matching

function getBoundingBox(data, w, h) {
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4] < 140) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return null;
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04);
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    w: Math.min(w, maxX - minX + 1 + pad * 2),
    h: Math.min(h, maxY - minY + 1 + pad * 2),
  };
}

function downsampleToGrid(ctx, bbox, gridSize) {
  const tmp = document.createElement("canvas");
  tmp.width = gridSize;
  tmp.height = gridSize;
  const tctx = tmp.getContext("2d");
  tctx.fillStyle = "#fff";
  tctx.fillRect(0, 0, gridSize, gridSize);
  if (!bbox) return new Uint8Array(gridSize * gridSize);
  const scale = Math.min(gridSize / bbox.w, gridSize / bbox.h) * 0.88;
  const dw = bbox.w * scale;
  const dh = bbox.h * scale;
  const dx = (gridSize - dw) / 2;
  const dy = (gridSize - dh) / 2;
  tctx.drawImage(ctx.canvas, bbox.x, bbox.y, bbox.w, bbox.h, dx, dy, dw, dh);
  const pixels = tctx.getImageData(0, 0, gridSize, gridSize).data;
  const grid = new Uint8Array(gridSize * gridSize);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = pixels[i * 4] < 140 ? 1 : 0; // tighter threshold
  }
  return grid;
}

function dilateGrid(grid, size, radius) {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y * size + x]) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < size && nx >= 0 && nx < size) {
              out[ny * size + nx] = 1;
            }
          }
        }
      }
    }
  }
  return out;
}

function compareGrids(userGrid, expectedGrid, size) {
  const userDilated = dilateGrid(userGrid, size, DILATE_R);
  const expectedDilated = dilateGrid(expectedGrid, size, DILATE_R);
  let expectedCount = 0, userCount = 0;
  let overlapOnExpected = 0, overlapOnUser = 0;
  for (let i = 0; i < size * size; i++) {
    if (expectedGrid[i]) { expectedCount++; if (userDilated[i]) overlapOnExpected++; }
    if (userGrid[i]) { userCount++; if (expectedDilated[i]) overlapOnUser++; }
  }
  if (expectedCount === 0 || userCount === 0) return 0;
  const coverage = overlapOnExpected / expectedCount;
  const precision = overlapOnUser / userCount;
  // Stricter scoring: require both good coverage AND precision
  const f1 = (coverage * precision > 0) ? 2 * coverage * precision / (coverage + precision) : 0;
  const score = Math.min(Math.round(f1 * 105), 100);
  return score;
}

// ── Components ──

function DrawingCanvas({ expectedHanzi, onResult, onClose }) {
  const chars = expectedHanzi.split("").filter((c) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c));
  const pinyinArr = splitPinyin(expectedHanzi);
  const canvasRefs = useRef([]);
  const overlayRef = useRef(null);
  const [checked, setChecked] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const filledBoxes = useRef(new Set());
  const strokeHistory = useRef([]); // for undo
  const autoCheckTimer = useRef(null);
  const isDrawingRef = useRef(false);

  const charCount = chars.length || 1;
  // Keep all boxes on single line — shrink size to fit
  const maxBoxes = charCount;
  const SIZE = Math.min(140, Math.floor((window.innerWidth - 40 - (maxBoxes - 1) * 6) / maxBoxes));

  const allFilled = () => filledBoxes.current.size >= chars.length;

  const scheduleAutoCheck = useCallback(() => {
    if (autoCheckTimer.current) clearTimeout(autoCheckTimer.current);
    if (!allFilled()) return;
    autoCheckTimer.current = setTimeout(() => {
      if (!isDrawingRef.current) doCheck();
    }, 1000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => { if (autoCheckTimer.current) clearTimeout(autoCheckTimer.current); };
  }, []);

  function clearAll() {
    if (autoCheckTimer.current) clearTimeout(autoCheckTimer.current);
    canvasRefs.current.forEach((canvas) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, SIZE, SIZE);
      drawGrid(ctx, SIZE);
    });
    filledBoxes.current = new Set();
    strokeHistory.current = [];
    setChecked(false);
    setShowResult(false);
  }

  function undoLast() {
    if (autoCheckTimer.current) clearTimeout(autoCheckTimer.current);
    // Clear all and redraw all strokes except last
    if (strokeHistory.current.length === 0) return;
    strokeHistory.current.pop();
    // Redraw everything
    canvasRefs.current.forEach((canvas) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, SIZE, SIZE);
      drawGrid(ctx, SIZE);
    });
    filledBoxes.current = new Set();
    strokeHistory.current.forEach((stroke) => {
      const canvas = canvasRefs.current[stroke.index];
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      ctx.strokeStyle = "#1c1c1e";
      ctx.lineWidth = Math.max(3, SIZE * 0.022);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let j = 1; j < stroke.points.length; j++) {
        ctx.beginPath();
        ctx.moveTo(stroke.points[j - 1].x, stroke.points[j - 1].y);
        ctx.lineTo(stroke.points[j].x, stroke.points[j].y);
        ctx.stroke();
      }
      filledBoxes.current.add(stroke.index);
    });
  }

  function drawGrid(ctx, s) {
    ctx.strokeStyle = "rgba(58, 107, 74, 0.06)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s);
    ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function doCheck() { // eslint-disable-line react-hooks/exhaustive-deps
    if (checked || !canvasRefs.current.some(Boolean)) return;
    if (!allFilled()) return;

    const overlay = overlayRef.current;
    const octx = overlay.getContext("2d");
    let totalScore = 0;

    chars.forEach((char, i) => {
      const canvas = canvasRefs.current[i];
      if (!canvas) return;

      octx.clearRect(0, 0, SIZE, SIZE);
      octx.fillStyle = "#fff";
      octx.fillRect(0, 0, SIZE, SIZE);
      octx.fillStyle = "#1c1c1e";
      octx.font = `bold ${SIZE * 0.72}px "Noto Serif SC", "Songti SC", serif`;
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      octx.fillText(char, SIZE / 2, SIZE / 2 + SIZE * 0.02);

      const userCtx = canvas.getContext("2d");
      const userData = userCtx.getImageData(0, 0, SIZE, SIZE).data;
      const expectedData = octx.getImageData(0, 0, SIZE, SIZE).data;

      const userBB = getBoundingBox(userData, SIZE, SIZE);
      const expectedBB = getBoundingBox(expectedData, SIZE, SIZE);

      const userGrid = downsampleToGrid(userCtx, userBB, GRID);
      const expectedGrid = downsampleToGrid(octx, expectedBB, GRID);

      const score = compareGrids(userGrid, expectedGrid, GRID);
      totalScore += score;
    });

    const avg = Math.round(totalScore / chars.length);
    setChecked(true);
    // Animate: shrink user drawing, show correct below
    setShowResult(true);
    if (onResult) onResult(avg);
  }

  function setCanvasRef(i, el) {
    canvasRefs.current[i] = el;
  }

  function handleStrokeStart() {
    isDrawingRef.current = true;
    if (autoCheckTimer.current) clearTimeout(autoCheckTimer.current);
  }

  function handleStrokeEnd(index, points) {
    isDrawingRef.current = false;
    filledBoxes.current.add(index);
    if (points && points.length > 0) {
      strokeHistory.current.push({ index, points: [...points] });
    }
    scheduleAutoCheck();
  }

  return (
    <div className="drawing-panel">
      <div className="drawing-multi-wrap">
        {chars.map((char, i) => (
          <div key={i} className="drawing-char-col">
            <span className="drawing-char-pinyin">{pinyinArr[i] || ""}</span>
            <div className={`drawing-canvas-area ${showResult ? "shrunk" : ""}`}>
              <SingleCanvasWithRef
                index={i}
                size={SIZE}
                disabled={checked}
                onStrokeStart={handleStrokeStart}
                onStrokeEnd={(pts) => handleStrokeEnd(i, pts)}
                refCallback={setCanvasRef}
              />
            </div>
            {showResult && (
              <div className="drawing-correct-char" style={{ width: SIZE, height: SIZE }}>
                <span>{char}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <canvas ref={overlayRef} width={SIZE} height={SIZE} style={{ display: "none" }} />

      <div className="drawing-actions">
        {!checked ? (
          <button className="drawing-undo-btn" type="button" onClick={undoLast} disabled={strokeHistory.current.length === 0} aria-label="撤销">
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12.5 8c-2.65 0-5.05 1.04-6.83 2.73L3 8v9h9l-2.83-2.83A7.95 7.95 0 0 1 12.5 10c3.04 0 5.64 1.71 6.96 4.21l1.77-.77A9.96 9.96 0 0 0 12.5 8Z"/></svg>
          </button>
        ) : (
          <button className="drawing-btn" type="button" onClick={clearAll}>再试</button>
        )}
      </div>
    </div>
  );
}

function SingleCanvasWithRef({ index, size, disabled, onStrokeStart, onStrokeEnd, refCallback }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPoint = useRef(null);
  const currentStrokePoints = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    refCallback(index, canvas);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(58, 107, 74, 0.06)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [index, size, refCallback]);

  function getPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const scale = size / rect.width;
    if (e.touches) return { x: (e.touches[0].clientX - rect.left) * scale, y: (e.touches[0].clientY - rect.top) * scale };
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  }

  function startStroke(e) {
    if (disabled) return;
    e.preventDefault();
    setIsDrawing(true);
    const pos = getPos(e);
    lastPoint.current = pos;
    currentStrokePoints.current = [pos];
    onStrokeStart?.();
  }

  function moveStroke(e) {
    if (!isDrawing || disabled) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const pos = getPos(e);
    ctx.strokeStyle = "#1c1c1e";
    ctx.lineWidth = Math.max(3, size * 0.022);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPoint.current = pos;
    currentStrokePoints.current.push(pos);
  }

  function endStroke() {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPoint.current = null;
    onStrokeEnd?.(currentStrokePoints.current);
    currentStrokePoints.current = [];
  }

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="drawing-single-canvas"
      onMouseDown={startStroke}
      onMouseMove={moveStroke}
      onMouseUp={endStroke}
      onMouseLeave={endStroke}
      onTouchStart={startStroke}
      onTouchMove={moveStroke}
      onTouchEnd={endStroke}
    />
  );
}

export default DrawingCanvas;
