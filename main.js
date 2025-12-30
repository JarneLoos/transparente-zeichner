const drawingCanvas = document.getElementById('drawingCanvas');
const previewCanvas = document.getElementById('previewCanvas');
let previewCtx = previewCanvas.getContext('2d');

const segmentsInput = document.getElementById('segments');
const brushSizeInput = document.getElementById('brushSize');
const segmentValue = document.getElementById('segmentValue');
const brushValue = document.getElementById('brushValue');

const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 50;

// View transform (Zoom / Pan)
let scale = 1;
const MIN_SCALE = 1;
const MAX_SCALE = 4;
let offsetX = 0; // translation in CSS pixels
let offsetY = 0;

// Pan state
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panOriginOffsetX = 0;
let panOriginOffsetY = 0;

let isDrawing = false;
let lastX = 0;
let lastY = 0;
let currentTool = 'eraser';
let startX = 0;
let startY = 0;
let previewImageData = null;

let showGuides = true;

// Touch / Pinch state
let isPinching = false;
let pinchData = null; // { startDist, initialScale, panOriginOffsetX, panOriginOffsetY, startCenterClientX, startCenterClientY }

// Layers management
let layers = [];
let currentLayerIndex = 0;

// Segment positioning / size factor (Segment slightly smaller and centered)
let segOffX = -200;
let segOffY = 500;
const SEGMENT_RADIUS_FACTOR = 1.75;

// Popup / settings: reusable element
let __layerSettingsPopup = null;
let __layerSettingsOutsideListener = null;

// Colors for automatic layer color sequence (start at yellow)
const LAYER_HUE_START = 60; // yellow
const LAYER_HUE_STEP = 15;

let showOnlySelected = false;

class Layer {
    constructor(name) {
        this.name = name;
        this.opacity = 0.5;
        this.visible = true;
        this.color = '#2d7a8f';
        this.canvas = document.createElement('canvas');
        this.canvas.width = drawingCanvas.width;
        this.canvas.height = drawingCanvas.height;
        this.ctx = this.canvas.getContext('2d');
    }
}

// --- Transform helpers ---
drawingCanvas.style.transformOrigin = '0 0';

// Adjust #canvasViewport so it fits into the browser window
function adjustCanvasViewportSize() {
    const viewport = document.getElementById('canvasViewport');
    if (!viewport) return;

    const left = document.querySelector('.sidebar-left');
    const right = document.querySelector('.sidebar-right');

    // On narrow screens (CSS @media max-width:980px) sidebars are below the canvas
    const isMobile = window.matchMedia('(max-width: 980px)').matches;

    const leftW = (!isMobile && left) ? left.getBoundingClientRect().width : 0;
    const rightW = (!isMobile && right) ? right.getBoundingClientRect().width : 0;

    // Body/container padding (20px left + 20px right)
    const horizPadding = 50;

    // available width for center column (CSS px)
    const availableWidth = Math.max(120, window.innerWidth - leftW - rightW - horizPadding);

    // available height from viewport top to bottom
    const rect = viewport.getBoundingClientRect();
    const availableHeight = Math.max(120, window.innerHeight - Math.max(0, rect.top) + 20);

    // Square viewport size: as large as possible but smaller than both
    const size = Math.floor(Math.min(availableWidth, availableHeight) * 0.95);

    viewport.style.width = size + 'px';
    viewport.style.height = size + 'px';
}

// Resize drawing canvas to fit #canvasViewport (HiDPI aware) and preserve layer contents
function resizeDrawingCanvas() {
    const viewport = document.getElementById('canvasViewport');
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const displayW = Math.max(1, Math.round(rect.width));
    const displayH = Math.max(1, Math.round(rect.height));

    const pixelW = displayW * dpr;
    const pixelH = displayH * dpr;

    // If size unchanged, nothing to do
    if (drawingCanvas.width === pixelW && drawingCanvas.height === pixelH) return;

    // Save old sizes to resample layers
    const oldW = drawingCanvas.width;
    const oldH = drawingCanvas.height;

    // --- Keep segment offset proportional to canvas size ---
    if (oldW && oldH) {
        const scaleX = pixelW / oldW;
        const scaleY = pixelH / oldH;
        segOffX *= scaleX;
        segOffY *= scaleY;
    }

    // Resize main drawing canvas (this resets its context)
    drawingCanvas.width = pixelW;
    drawingCanvas.height = pixelH;
    drawingCanvas.style.width = displayW + 'px';
    drawingCanvas.style.height = displayH + 'px';

    // re-acquire context
    ctx = drawingCanvas.getContext('2d');

    // Resample each layer to new size (preserve content)
    layers.forEach(layer => {
        const tmp = document.createElement('canvas');
        tmp.width = oldW || 1;
        tmp.height = oldH || 1;
        const tmpCtx = tmp.getContext('2d');

        tmpCtx.clearRect(0, 0, tmp.width, tmp.height);
        tmpCtx.drawImage(layer.canvas, 0, 0, tmp.width, tmp.height);

        layer.canvas.width = pixelW;
        layer.canvas.height = pixelH;

        layer.ctx = layer.canvas.getContext('2d');
        layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        layer.ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, layer.canvas.width, layer.canvas.height);
    });

    drawingCanvas.style.transformOrigin = '0 0';
    updateTransformStyle();

    ensurePreviewBuffer();

    renderDrawingCanvas();
    updatePreview();
}

function updateTransformStyle() {
    drawingCanvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    if (isPanning) {
        drawingCanvas.style.cursor = 'grabbing';
    } else {
        drawingCanvas.style.cursor = 'crosshair';
    }
}

function screenToCanvasCoords(clientX, clientY) {
    const rect = drawingCanvas.getBoundingClientRect();

    // CSS px -> canvas internal px
    const scaleX = drawingCanvas.width / rect.width;
    const scaleY = drawingCanvas.height / rect.height;

    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;

    const x = cssX * scaleX;
    const y = cssY * scaleY;

    return { x, y };
}

// Ensure preview canvas internal buffer matches displayed size (HiDPI aware)
function ensurePreviewBuffer() {
    if (!previewCanvas) return;
    const rect = previewCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const displayW = Math.max(1, Math.round(rect.width || previewCanvas.style.width.replace('px', '') || previewCanvas.width));
    const displayH = Math.max(1, Math.round(rect.height || previewCanvas.style.height.replace('px', '') || previewCanvas.height));
    const pixelW = displayW * dpr;
    const pixelH = displayH * dpr;

    if (previewCanvas.width !== pixelW || previewCanvas.height !== pixelH) {
        previewCanvas.width = pixelW;
        previewCanvas.height = pixelH;
        previewCanvas.style.width = displayW + 'px';
        previewCanvas.style.height = displayH + 'px';
        previewCtx = previewCanvas.getContext('2d');
        previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
}

// UpdatePreview: computes segment metrics in preview display pixels and centers main canvas
function updatePreview() {
    if (!previewCanvas) return;
    ensurePreviewBuffer();
    if (!previewCtx) return;

    const dpr = window.devicePixelRatio || 1;
    const displayW = previewCanvas.width / dpr;
    const displayH = previewCanvas.height / dpr;

    const info = getSegmentInfo();
    if (!info) return;

    const fullDestW = displayW;
    const fullDestH = displayH;
    const baseScale = fullDestW / drawingCanvas.width;

    let dispRadius = info.radius * baseScale;

    const maxAllowedRadius = Math.min(displayW, displayH) / 2 * 0.98;

    const fitScale = dispRadius > 0 ? Math.min(1, maxAllowedRadius / dispRadius) : 1;

    const destW = fullDestW * fitScale;
    const destH = fullDestH * fitScale;
    const scale = destW / drawingCanvas.width;

    const centerX = displayW / 2;
    const centerY = displayH / 2;
    const dx = centerX - info.cx * scale;
    const dy = centerY - info.cy * scale;

    const dispRadiusFinal = info.radius * scale;
    const anglePerSegment = info.anglePerSegment;
    const startAngle = info.startAngle;

    previewCtx.save();
    previewCtx.clearRect(0, 0, displayW, displayH);
    previewCtx.fillStyle = canvasBgColor;
    previewCtx.fillRect(0, 0, displayW, displayH);

    for (let i = 0; i < info.segments; i++) {
        previewCtx.save();

        previewCtx.translate(centerX, centerY);
        previewCtx.rotate(anglePerSegment * i);

        if (i % 2 === 1) {
            previewCtx.rotate(anglePerSegment / 2);
            previewCtx.scale(-1, 1);
            previewCtx.rotate(-anglePerSegment / 2);
        }

        previewCtx.translate(-centerX, -centerY);

        previewCtx.beginPath();
        previewCtx.moveTo(centerX, centerY);
        previewCtx.lineTo(
            centerX + dispRadiusFinal * Math.cos(startAngle),
            centerY + dispRadiusFinal * Math.sin(startAngle)
        );
        previewCtx.arc(centerX, centerY, dispRadiusFinal, startAngle, startAngle + anglePerSegment);
        previewCtx.closePath();
        previewCtx.clip();

        previewCtx.drawImage(
            drawingCanvas,
            0, 0, drawingCanvas.width, drawingCanvas.height,
            dx, dy, destW, destH
        );

        previewCtx.restore();
    }

    previewCtx.restore();
}

// Draw composed drawing canvas from layer canvases
function renderDrawingCanvas() {
    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    ctx.fillStyle = typeof canvasBgColor !== 'undefined' ? canvasBgColor : '#ffffff';
    ctx.fillRect(0, 0, drawingCanvas.width, drawingCanvas.height);

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];

        if (showOnlySelected) {
            if (i !== currentLayerIndex) continue;
        } else if (!layer.visible) {
            continue;
        }

        ctx.globalAlpha = layer.opacity;
        ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;

    drawSegmentGuideOverlay();
}

// Draw the segment guide overlay
function drawSegmentGuideOverlay() {
    const info = getSegmentInfo();

    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = Math.max(1, Math.round(2 * (window.devicePixelRatio || 1)));

    if (showGuides) {
        ctx.beginPath();
        ctx.moveTo(info.cx, info.cy);
        ctx.lineTo(
            info.cx + info.radius * Math.cos(info.startAngle),
            info.cy + info.radius * Math.sin(info.startAngle)
        );
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(info.cx, info.cy);
        ctx.lineTo(
            info.cx + info.radius * Math.cos(info.startAngle + info.anglePerSegment),
            info.cy + info.radius * Math.sin(info.startAngle + info.anglePerSegment)
        );
        ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(info.cx, info.cy, info.radius, info.startAngle, info.startAngle + info.anglePerSegment);
    ctx.stroke();

    ctx.restore();
}

// Layers functions
function addLayer(name = null) {
    if (!name) name = `Layer ${layers.length + 1}`;
    const layer = new Layer(name);

    const hue = (LAYER_HUE_START - layers.length * LAYER_HUE_STEP + 3600) % 360;
    const hslColor = `hsl(${hue}, 70%, 50%)`;
    layer.color = hslToHex(hslColor);

    layer.ctx.save();
    applySegmentClip(layer.ctx);
    layer.ctx.fillStyle = layer.color;
    layer.ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
    layer.ctx.restore();

    layers.push(layer);
    currentLayerIndex = layers.length - 1;
    updateLayersPanel();
    renderDrawingCanvas();
    updatePreview();
}

function deleteLayer() {
    if (layers.length <= 1) {
        alert('You must have at least one layer!');
        return;
    }
    layers.splice(currentLayerIndex, 1);
    if (currentLayerIndex >= layers.length) currentLayerIndex = layers.length - 1;
    updateLayersPanel();
    renderDrawingCanvas();
    updatePreview();
}

function copyLayer() {
    if (!layers || layers.length === 0) return;

    saveState();

    const src = layers[currentLayerIndex];

    const baseName = src.name.replace(/\s*\(\d+\)\s*$/, '').trim();

    function escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    }

    const baseEsc = escapeRegex(baseName);
    const re = new RegExp('^' + baseEsc + '\\s*\\((\\d+)\\)$');
    let maxIndex = 0;
    for (let i = 0; i < layers.length; i++) {
        const m = layers[i].name.match(re);
        if (m) {
            const n = parseInt(m[1], 10);
            if (!isNaN(n) && n > maxIndex) maxIndex = n;
        }
    }

    const nextIndex = maxIndex + 1;
    const copyName = `${baseName} (${nextIndex})`;

    const newLayer = new Layer(copyName);
    newLayer.opacity = src.opacity;
    newLayer.visible = src.visible;

    const hue = (LAYER_HUE_START - layers.length * LAYER_HUE_STEP + 3600) % 360;
    const hslColor = `hsl(${hue}, 70%, 50%)`;
    newLayer.color = hslToHex(hslColor);

    newLayer.ctx.clearRect(0, 0, newLayer.canvas.width, newLayer.canvas.height);
    newLayer.ctx.drawImage(
        src.canvas,
        0, 0, src.canvas.width, src.canvas.height,
        0, 0, newLayer.canvas.width, newLayer.canvas.height
    );

    try {
        const w = newLayer.canvas.width;
        const h = newLayer.canvas.height;
        const imageData = newLayer.ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        const rNew = parseInt(newLayer.color.slice(1, 3), 16);
        const gNew = parseInt(newLayer.color.slice(3, 5), 16);
        const bNew = parseInt(newLayer.color.slice(5, 7), 16);

        for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a !== 0) {
                data[i] = rNew;
                data[i + 1] = gNew;
                data[i + 2] = bNew;
            }
        }
        newLayer.ctx.putImageData(imageData, 0, 0);
    } catch (err) {
        console.warn('Recolor failed for copied layer:', err);
    }

    const insertIndex = currentLayerIndex + 1;
    layers.splice(insertIndex, 0, newLayer);
    currentLayerIndex = insertIndex;

    updateLayersPanel();
    renderDrawingCanvas();
    updatePreview();
}

function updateLayersPanel() {
    const panel = document.getElementById('layersPanel');
    panel.innerHTML = '';

    for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];

        const layerItem = document.createElement('div');
        layerItem.className = `layer-item ${i === currentLayerIndex ? 'active' : ''}`;
        layerItem.dataset.index = i;
        layerItem.style.display = 'flex';
        layerItem.style.alignItems = 'center';
        layerItem.style.gap = '8px';
        layerItem.style.padding = '6px';

        const visWrapper = document.createElement('div');
        visWrapper.className = 'layer-vis-wrapper';
        const visibilityCheckbox = document.createElement('input');
        visibilityCheckbox.type = 'checkbox';
        visibilityCheckbox.className = 'layer-visibility';
        visibilityCheckbox.checked = layer.visible;
        visibilityCheckbox.addEventListener('change', (e) => {
            e.stopPropagation();
            toggleLayerVisibility(i, visibilityCheckbox.checked);
        });
        visibilityCheckbox.addEventListener('click', e => e.stopPropagation());
        visibilityCheckbox.addEventListener('mousedown', e => e.stopPropagation());
        visWrapper.appendChild(visibilityCheckbox);
        layerItem.appendChild(visWrapper);

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'layer-color';
        colorInput.value = layer.color;
        colorInput.title = 'Change color';
        colorInput.addEventListener('change', (e) => {
            e.stopPropagation();
            setLayerColor(i, colorInput.value);
        });
        colorInput.addEventListener('click', e => e.stopPropagation());
        colorInput.addEventListener('mousedown', e => e.stopPropagation());
        layerItem.appendChild(colorInput);

        const title = document.createElement('div');
        title.className = 'layer-title';
        title.textContent = layer.name;
        title.style.flex = '1';
        title.style.cursor = 'pointer';
        title.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT') return;
            selectLayer(i);
        });
        layerItem.appendChild(title);

        const gearBtn = document.createElement('button');
        gearBtn.type = 'button';
        gearBtn.className = 'layer-gear';
        gearBtn.innerHTML = '⚙';
        gearBtn.title = 'Settings';
        gearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openLayerSettings(i, gearBtn);
        });
        layerItem.appendChild(gearBtn);

        const dragHandle = document.createElement('div');
        dragHandle.className = 'layer-drag-handle';
        dragHandle.textContent = '⋮⋮';
        dragHandle.draggable = true;

        dragHandle.addEventListener('dragstart', ev => {
            ev.dataTransfer.setData('text/plain', i.toString());
            layerItem.classList.add('dragging');
        });

        dragHandle.addEventListener('dragend', () => {
            layerItem.classList.remove('dragging');
            document.querySelectorAll('.layer-item.drag-over').forEach(el =>
                el.classList.remove('drag-over')
            );
        });

        layerItem.addEventListener('dragover', ev => {
            ev.preventDefault();
            layerItem.classList.add('drag-over');
        });

        layerItem.addEventListener('dragleave', () => {
            layerItem.classList.remove('drag-over');
        });

        layerItem.addEventListener('drop', ev => {
            ev.preventDefault();
            layerItem.classList.remove('drag-over');
            const fromIndex = parseInt(ev.dataTransfer.getData('text/plain'), 10);
            const toIndex = parseInt(layerItem.dataset.index, 10);
            if (!isNaN(fromIndex) && fromIndex !== toIndex) {
                moveLayer(fromIndex, toIndex);
            }
        });

        layerItem.appendChild(dragHandle);

        panel.appendChild(layerItem);
    }
}

function selectLayer(index) {
    currentLayerIndex = index;
    updateLayersPanel();

    if (showOnlySelected) {
        showOnlySelected = false;
        renderDrawingCanvas();
        updatePreview();
        showOnlySelected = true;
        renderDrawingCanvas();
    }
}

function setLayerOpacity(index, value) {
    layers[index].opacity = value / 100;
    renderDrawingCanvas();
    updatePreview();
}

function toggleLayerVisibility(index, visible) {
    layers[index].visible = visible;

    if (showOnlySelected) {
        showOnlySelected = false;
        renderDrawingCanvas();
        updatePreview();
        showOnlySelected = true;
        renderDrawingCanvas();
    } else {
        renderDrawingCanvas();
        updatePreview();
    }
}

function getCurrentLayer() {
    return layers[currentLayerIndex];
}

function moveLayer(fromIndex, toIndex) {
    const [movedLayer] = layers.splice(fromIndex, 1);
    layers.splice(toIndex, 0, movedLayer);

    if (currentLayerIndex === fromIndex) {
        currentLayerIndex = toIndex;
    } else if (fromIndex < toIndex && currentLayerIndex <= toIndex) {
        currentLayerIndex--;
    } else if (fromIndex > toIndex && currentLayerIndex >= toIndex) {
        currentLayerIndex++;
    }

    saveState();
    updateLayersPanel();
    renderDrawingCanvas();
    updatePreview();
}

function setLayerColor(index, color) {
    const layer = layers[index];
    layer.color = color;

    const imageData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha > 0) {
            data[i] = parseInt(color.slice(1, 3), 16);
            data[i + 1] = parseInt(color.slice(3, 5), 16);
            data[i + 2] = parseInt(color.slice(5, 7), 16);
            data[i + 3] = alpha;
        }
    }

    layer.ctx.putImageData(imageData, 0, 0);
    renderDrawingCanvas();
    updatePreview();
}

function openLayerSettings(index, anchorEl) {
    closeLayerSettings();

    const layer = layers[index];
    if (!layer) return;

    // Create popup
    __layerSettingsPopup = document.createElement('div');
    __layerSettingsPopup.className = 'layer-settings-popup';
    __layerSettingsPopup.innerHTML = `
        <label class="ls-row"><span>Title</span><input type="text" class="ls-title" value="${escapeHtml(layer.name)}" /></label>
        <label class="ls-row"><span>Opacity</span><input type="range" class="ls-opacity" min="0" max="100" value="${Math.round(layer.opacity * 100)}" /></label>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
            <button type="button" class="btn-secondary ls-close">Close</button>
        </div>
    `;

    document.body.appendChild(__layerSettingsPopup);

    // Position popup near anchor
    const aRect = anchorEl.getBoundingClientRect();
    const popupRect = __layerSettingsPopup.getBoundingClientRect();
    let left = Math.min(window.innerWidth - popupRect.width - 8, aRect.right + 8);
    if (left < 8) left = 8;
    let top = aRect.top;
    if (top + popupRect.height > window.innerHeight - 8) {
        top = Math.max(8, aRect.top - popupRect.height - 8);
    }
    __layerSettingsPopup.style.left = `${left}px`;
    __layerSettingsPopup.style.top = `${top}px`;

    const titleInput = __layerSettingsPopup.querySelector('.ls-title');
    const opacityInput = __layerSettingsPopup.querySelector('.ls-opacity');
    const closeBtn = __layerSettingsPopup.querySelector('.ls-close');

    titleInput.addEventListener('input', (e) => {
        layer.name = e.target.value;
        const panel = document.getElementById('layersPanel');
        const titleElems = panel.querySelectorAll('.layer-item');
        titleElems.forEach(item => {
            if (parseInt(item.dataset.index, 10) === index) {
                const t = item.querySelector('.layer-title');
                if (t) t.textContent = layer.name;
            }
        });
    });

    opacityInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        setLayerOpacity(index, val);
    });

    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeLayerSettings();
    });

    __layerSettingsOutsideListener = (ev) => {
        if (!__layerSettingsPopup) return;
        if (!__layerSettingsPopup.contains(ev.target) && ev.target !== anchorEl) {
            closeLayerSettings();
        }
    };
    document.addEventListener('mousedown', __layerSettingsOutsideListener);
}

function closeLayerSettings() {
    if (__layerSettingsPopup) {
        __layerSettingsPopup.remove();
        __layerSettingsPopup = null;
    }
    if (__layerSettingsOutsideListener) {
        document.removeEventListener('mousedown', __layerSettingsOutsideListener);
        __layerSettingsOutsideListener = null;
    }
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": "&#39;" }[m]));
}

// --- Undo/Redo ---
function saveState() {
    const snapshot = layers.map(layer =>
        layer.ctx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height)
    );
    undoStack.push(snapshot);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
}

function restoreState(snapshot) {
    snapshot.forEach((imageData, index) => {
        layers[index].ctx.putImageData(imageData, 0, 0);
    });
    renderDrawingCanvas();
    updatePreview();
}

function undo() {
    if (undoStack.length === 0) return;
    const currentState = layers.map(layer => layer.ctx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height));
    redoStack.push(currentState);
    const previousState = undoStack.pop();
    restoreState(previousState);
}

function redo() {
    if (redoStack.length === 0) return;
    const currentState = layers.map(layer => layer.ctx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height));
    undoStack.push(currentState);
    const nextState = redoStack.pop();
    restoreState(nextState);
}

function getSegmentInfo() {
    const segments = Math.max(1, parseInt(segmentsInput?.value || '12', 10));
    const cx = drawingCanvas.width / 2 + (segOffX || 0);
    const cy = drawingCanvas.height / 2 + (segOffY || 0);
    const radius = Math.min(drawingCanvas.width, drawingCanvas.height) * 0.5 * SEGMENT_RADIUS_FACTOR;
    const anglePerSegment = (Math.PI * 2) / segments;
    const startAngle = -Math.PI / 2;
    return { segments, cx, cy, radius, anglePerSegment, startAngle };
}

function applySegmentClip(ctx) {
    const info = getSegmentInfo();
    ctx.beginPath();
    ctx.moveTo(info.cx, info.cy);
    ctx.lineTo(
        info.cx + info.radius * Math.cos(info.startAngle),
        info.cy + info.radius * Math.sin(info.startAngle)
    );
    ctx.arc(info.cx, info.cy, info.radius, info.startAngle, info.startAngle + info.anglePerSegment);
    ctx.closePath();
    ctx.clip();
}

function isPointInSegment(x, y) {
    const info = getSegmentInfo();
    const dx = x - info.cx;
    const dy = y - info.cy;
    const dist = Math.hypot(dx, dy);
    if (dist > info.radius) return false;

    let angle = Math.atan2(dy, dx);
    let rel = angle - info.startAngle;
    while (rel < 0) rel += Math.PI * 2;
    while (rel >= Math.PI * 2) rel -= Math.PI * 2;

    return rel >= 0 && rel <= info.anglePerSegment;
}

function hslToHex(hsl) {
    const hslRegex = /hsl\((\d+),\s*(\d+)%\,\s*(\d+)%\)/i;
    const match = hsl.match(hslRegex);
    if (!match) return '#2d7a8f';
    const h = parseInt(match[1]) / 360;
    const s = parseInt(match[2]) / 100;
    const l = parseInt(match[3]) / 100;
    let r, g, b;
    if (s === 0) r = g = b = l;
    else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return '#' + Math.round(r * 255).toString(16).padStart(2, '0') +
        Math.round(g * 255).toString(16).padStart(2, '0') +
        Math.round(b * 255).toString(16).padStart(2, '0');
}

function clampPan() {
    const viewport = document.getElementById('canvasViewport');
    const viewW = viewport.clientWidth;
    const viewH = viewport.clientHeight;

    const canvasRect = drawingCanvas.getBoundingClientRect();
    const canvasW = canvasRect.width;
    const canvasH = canvasRect.height;

    const TOLERANCE = 200;

    if (canvasW <= viewW) {
        offsetX = (viewW - canvasW) / 2;
    } else {
        const minX = (viewW - canvasW);
        const maxX = 0;
        offsetX = softClamp(offsetX, minX, maxX, TOLERANCE);
    }

    if (canvasH <= viewH) {
        offsetY = (viewH - canvasH) / 2;
    } else {
        const minY = viewH - canvasH;
        const maxY = 0;
        offsetY = softClamp(offsetY, minY, maxY, TOLERANCE);
    }
}

function softClamp(value, min, max, tolerance) {
    if (value < min) {
        const d = min - value;
        if (d > tolerance) return min - tolerance;
        return min - d;
    }

    if (value > max) {
        const d = value - max;
        if (d > tolerance) return max + tolerance;
        return max + d;
    }

    return value;
}

// --- Drawing event handlers ---
drawingCanvas.addEventListener('mousedown', (e) => {
    // Middle mouse -> start panning
    if (e.button === 1) {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panOriginOffsetX = offsetX;
        panOriginOffsetY = offsetY;
        updateTransformStyle();
        // prevent default to avoid autoscroll
        e.preventDefault();
        return;
    }

    // Left click -> drawing
    if (e.button !== 0) return;

    saveState();
    isDrawing = true;

    const p = screenToCanvasCoords(e.clientX, e.clientY);
    lastX = p.x;
    lastY = p.y;
    startX = lastX;
    startY = lastY;

    const currentLayer = getCurrentLayer();
    previewImageData = currentLayer.ctx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height);

    if (currentTool === 'bucket') {
        floodFill(Math.round(lastX), Math.round(lastY), layers[currentLayerIndex].color);
        isDrawing = false;
    }
});

// Mouse move: either pan or draw
window.addEventListener('mousemove', (e) => {
    if (isPanning) {
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        offsetX = panOriginOffsetX + dx;
        offsetY = panOriginOffsetY + dy;
        clampPan();
        updateTransformStyle();
        return;
    }

    if (!isDrawing) return;

    const p = screenToCanvasCoords(e.clientX, e.clientY);
    const x = p.x;
    const y = p.y;

    const currentLayer = getCurrentLayer();
    const layerCtx = currentLayer.ctx;

    layerCtx.save();
    applySegmentClip(layerCtx);

    if (currentTool === 'brush' || currentTool === 'eraser') {
        if (currentTool === 'eraser') {
            layerCtx.globalCompositeOperation = 'destination-out';
            layerCtx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            layerCtx.globalCompositeOperation = 'source-over';
            layerCtx.strokeStyle = layers[currentLayerIndex].color;
        }

        layerCtx.lineWidth = parseInt(brushSizeInput.value);
        layerCtx.lineCap = 'round';
        layerCtx.lineJoin = 'round';

        layerCtx.beginPath();
        layerCtx.moveTo(lastX, lastY);
        layerCtx.lineTo(x, y);
        layerCtx.stroke();

        lastX = x;
        lastY = y;

        layerCtx.restore();
        renderDrawingCanvas();
        updatePreview();
    } else if (currentTool === 'line' || currentTool === 'circle' || currentTool === 'rectangle') {
        layerCtx.putImageData(previewImageData, 0, 0);

        layerCtx.globalCompositeOperation = 'source-over';
        layerCtx.strokeStyle = layers[currentLayerIndex].color;
        layerCtx.lineWidth = parseInt(brushSizeInput.value);
        layerCtx.lineCap = 'round';

        if (currentTool === 'line') {
            layerCtx.beginPath();
            layerCtx.moveTo(startX, startY);
            layerCtx.lineTo(x, y);
            layerCtx.stroke();
        } else if (currentTool === 'circle') {
            const radius = Math.hypot(x - startX, y - startY);
            layerCtx.beginPath();
            layerCtx.arc(startX, startY, radius, 0, Math.PI * 2);
            layerCtx.stroke();
        } else if (currentTool === 'rectangle') {
            layerCtx.strokeRect(startX, startY, x - startX, y - startY);
        }

        layerCtx.restore();
        renderDrawingCanvas();
        updatePreview();
    }
});

window.addEventListener('mouseup', (e) => {
    if (isPanning && e.button === 1) {
        isPanning = false;
        updateTransformStyle();
        return;
    }
    isDrawing = false;
});

drawingCanvas.addEventListener('mouseleave', () => {
    isDrawing = false;
});

// --- Touch events: single-finger drawing, two-finger pinch/pan ---
drawingCanvas.addEventListener('touchstart', (e) => {
    // prevent the browser default (scroll/zoom)
    e.preventDefault();

    const touches = e.touches;

    if (touches.length === 1) {
        // single-finger: drawing (like before)
        saveState();
        isDrawing = true;
        const touch = touches[0];
        const p = screenToCanvasCoords(touch.clientX, touch.clientY);
        lastX = p.x;
        lastY = p.y;
        startX = lastX;
        startY = lastY;
        const currentLayer = getCurrentLayer();
        previewImageData = currentLayer.ctx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height);

        if (currentTool === 'bucket') {
            floodFill(Math.round(lastX), Math.round(lastY), layers[currentLayerIndex].color);
            isDrawing = false;
        }
        // ensure not in pinch mode
        isPinching = false;
        pinchData = null;
    } else if (touches.length === 2) {
        // two-finger: start pinch/zoom + pan
        isDrawing = false; // stop any single-finger drawing
        isPinching = true;

        const t0 = touches[0];
        const t1 = touches[1];

        const startDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const centerClientX = (t0.clientX + t1.clientX) / 2;
        const centerClientY = (t0.clientY + t1.clientY) / 2;

        const rect = drawingCanvas.getBoundingClientRect();
        // px = canvas-space coordinate (used later to keep point under midpoint stable)
        const px = (centerClientX - rect.left) / scale;
        const py = (centerClientY - rect.top) / scale;

        pinchData = {
            startDist,
            initialScale: scale,
            panOriginOffsetX: offsetX,
            panOriginOffsetY: offsetY,
            startCenterClientX: centerClientX,
            startCenterClientY: centerClientY,
            startPx: px,
            startPy: py
        };
    } else {
        // 3+ touches: ignore for now
        isDrawing = false;
    }
}, { passive: false });

drawingCanvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touches = e.touches;

    if (isPinching && touches.length >= 2 && pinchData) {
        // handle pinch + two-finger pan
        const t0 = touches[0];
        const t1 = touches[1];

        const newDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const centerClientX = (t0.clientX + t1.clientX) / 2;
        const centerClientY = (t0.clientY + t1.clientY) / 2;

        const scaleFactor = newDist / pinchData.startDist;
        let newScale = pinchData.initialScale * scaleFactor;
        newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));

        // movement of midpoint -> pan
        const dxCenter = centerClientX - pinchData.startCenterClientX;
        const dyCenter = centerClientY - pinchData.startCenterClientY;

        // compute px/py relative to initial scale so the point under center stays stable
        // (use startPx/startPy computed on pinchstart)
        const deltaScale = newScale - pinchData.initialScale;

        offsetX = pinchData.panOriginOffsetX + dxCenter - deltaScale * pinchData.startPx;
        offsetY = pinchData.panOriginOffsetY + dyCenter - deltaScale * pinchData.startPy;

        scale = newScale;
        clampPan();
        updateTransformStyle();
        return;
    }

    // if not pinching, maybe single touch drawing
    if (touches.length === 1 && isDrawing) {
        const touch = touches[0];
        const p = screenToCanvasCoords(touch.clientX, touch.clientY);
        const x = p.x;
        const y = p.y;

        const currentLayer = getCurrentLayer();
        const layerCtx = currentLayer.ctx;

        layerCtx.save();
        applySegmentClip(layerCtx);

        if (currentTool === 'brush' || currentTool === 'eraser') {
            if (currentTool === 'eraser') {
                layerCtx.globalCompositeOperation = 'destination-out';
                layerCtx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                layerCtx.globalCompositeOperation = 'source-over';
                layerCtx.strokeStyle = layers[currentLayerIndex].color;
            }

            layerCtx.lineWidth = parseInt(brushSizeInput.value);
            layerCtx.lineCap = 'round';
            layerCtx.lineJoin = 'round';

            layerCtx.beginPath();
            layerCtx.moveTo(lastX, lastY);
            layerCtx.lineTo(x, y);
            layerCtx.stroke();

            lastX = x;
            lastY = y;

            layerCtx.restore();
            renderDrawingCanvas();
            updatePreview();
        } else if (currentTool === 'line' || currentTool === 'circle' || currentTool === 'rectangle') {
            layerCtx.putImageData(previewImageData, 0, 0);

            layerCtx.globalCompositeOperation = 'source-over';
            layerCtx.strokeStyle = layers[currentLayerIndex].color;
            layerCtx.lineWidth = parseInt(brushSizeInput.value);
            layerCtx.lineCap = 'round';

            if (currentTool === 'line') {
                layerCtx.beginPath();
                layerCtx.moveTo(startX, startY);
                layerCtx.lineTo(x, y);
                layerCtx.stroke();
            } else if (currentTool === 'circle') {
                const radius = Math.hypot(x - startX, y - startY);
                layerCtx.beginPath();
                layerCtx.arc(startX, startY, radius, 0, Math.PI * 2);
                layerCtx.stroke();
            } else if (currentTool === 'rectangle') {
                layerCtx.strokeRect(startX, startY, x - startX, y - startY);
            }

            layerCtx.restore();
            renderDrawingCanvas();
            updatePreview();
        }
    }
}, { passive: false });

drawingCanvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    const touches = e.touches;

    if (isPinching) {
        // if fingers reduced below 2 -> stop pinching
        if (touches.length < 2) {
            isPinching = false;
            pinchData = null;
            clampPan();
            updateTransformStyle();
        }
        // if still 2+ touches remain, keep pinching (handled by touchmove)
        return;
    }

    // if single-finger ended -> stop drawing
    if (isDrawing && touches.length === 0) {
        isDrawing = false;
    }
});

// Wheel: Zoom to mouse
drawingCanvas.addEventListener('wheel', (e) => {
    // only if pointer is over canvas
    e.preventDefault();

    const ZOOM_FACTOR = 1.12;
    const delta = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;

    const rect = drawingCanvas.getBoundingClientRect();
    // convert screen to canvas internal coords BEFORE change
    const px = (e.clientX - rect.left) / scale;
    const py = (e.clientY - rect.top) / scale;

    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * delta));
    // adjust offset so that (px,py) remains under the cursor
    offsetX = offsetX - (newScale - scale) * px;
    offsetY = offsetY - (newScale - scale) * py;
    scale = newScale;
    clampPan();
    updateTransformStyle();
}, { passive: false });


// Keyboard shortcuts for undo/redo
document.addEventListener('keydown', e => {
    if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undo();
    }

    if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        redo();
    }
});

// --- Background color control for both canvases ---
const bgColorPicker = document.getElementById('bgColorPicker');

// initial value (from picker)
let canvasBgColor = bgColorPicker.value;

// set CSS backgrounds
drawingCanvas.style.backgroundColor = canvasBgColor;
previewCanvas.style.backgroundColor = canvasBgColor;

// Event: live update when color changes
bgColorPicker.addEventListener('input', () => {
    canvasBgColor = bgColorPicker.value;
    drawingCanvas.style.backgroundColor = canvasBgColor;
    previewCanvas.style.backgroundColor = canvasBgColor;

    renderDrawingCanvas();
    updatePreview();
});

const showGuidesInput = document.getElementById('showGuides');
showGuidesInput.addEventListener('change', function () {
    showGuides = this.checked;
    renderDrawingCanvas();
    updatePreview();
});

const showOnlySelectedInput = document.getElementById('showOnlySelected');
showOnlySelectedInput.addEventListener('change', function () {
    showOnlySelected = this.checked;
    renderDrawingCanvas();
});

// Flood Fill (Boundary fill with alpha-tolerance and segment check)
function floodFill(x, y, fillColor) {
    const currentLayer = getCurrentLayer();
    const ctx = currentLayer.ctx;
    const width = drawingCanvas.width;
    const height = drawingCanvas.height;

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    const startIndex = (y * width + x) * 4;
    const startAlpha = data[startIndex + 3];

    const ALPHA_THRESHOLD = 200; // anti-alias tolerance
    if (startAlpha > ALPHA_THRESHOLD) return;

    const [fillR, fillG, fillB] = hexToRgb(fillColor);
    const fillA = 255;

    saveState();

    const stack = [[x, y]];
    const visited = new Uint8Array(width * height);

    const maxPixels = 2000000;
    let filled = 0;

    while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        const vi = cy * width + cx;
        const i = vi * 4;

        if (visited[vi]) continue;
        visited[vi] = 1;

        const alpha = data[i + 3];

        if (alpha > ALPHA_THRESHOLD) continue;
        if (!isPointInSegment(cx, cy)) continue;

        data[i] = fillR;
        data[i + 1] = fillG;
        data[i + 2] = fillB;
        data[i + 3] = fillA;

        filled++;
        if (filled > maxPixels) break;

        if (cx > 0) stack.push([cx - 1, cy]);
        if (cx < width - 1) stack.push([cx + 1, cy]);
        if (cy > 0) stack.push([cx, cy - 1]);
        if (cy < height - 1) stack.push([cx, cy + 1]);
    }

    ctx.putImageData(imageData, 0, 0);
    renderDrawingCanvas();
    updatePreview();
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16), 255] : [0, 0, 0, 255];
}

function clearDrawing() {
    saveState();
    const currentLayer = getCurrentLayer();
    const layerCtx = currentLayer.ctx;
    layerCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    renderDrawingCanvas();
    updatePreview();
}

function downloadImage() {
    const link = document.createElement('a');
    link.download = 'kaleidoscope.png';
    link.href = previewCanvas.toDataURL();
    link.click();
}

// Neue Funktion: Speichert jede Ebene einzeln als PNG
function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9_\-]/gi, '_');
}

function downloadLayers() {
    if (!layers || layers.length === 0) return;

    // kleine Verzögerung zwischen Klicks, damit Browser die Downloads nicht blockiert
    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];

        // Kopiere Ebene in temporäres Canvas (Originalgröße)
        const tmp = document.createElement('canvas');
        tmp.width = drawingCanvas.width;
        tmp.height = drawingCanvas.height;
        const tmpCtx = tmp.getContext('2d');

        // Transparenter Hintergrund: wir zeichnen direkt die Layer-Canvas (enthält Alpha)
        tmpCtx.clearRect(0, 0, tmp.width, tmp.height);
        tmpCtx.drawImage(layer.canvas, 0, 0);

        const dataUrl = tmp.toDataURL('image/png');

        const filename = `${String(i + 1).padStart(2, '0')}_${sanitizeFilename(layer.name)}${layer.visible ? '' : '_hidden'}.png`;

        // schedule click leicht gestaffelt
        setTimeout(() => {
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = filename;
            // some browsers require element in DOM for click to work reliably
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }, i * 120);
    }
}

// Steuerungs-Handlers
segmentsInput.addEventListener('input', (e) => {
    segmentValue.textContent = e.target.value;
    renderDrawingCanvas();
    updatePreview();
});

brushSizeInput.addEventListener('input', (e) => {
    brushValue.textContent = e.target.value;
});

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('[id^="tool"]').forEach(btn => {
        btn.style.background = '';
        btn.style.color = '';
    });
    const id = 'tool' + tool.charAt(0).toUpperCase() + tool.slice(1);
    const el = document.getElementById(id);
    if (el) { el.style.background = 'var(--color-primary)'; el.style.color = 'white'; }
}

// Initialisierung
function initializeCanvases() {
    // set CSS backgrounds
    drawingCanvas.style.backgroundColor = 'white';
    previewCanvas.style.backgroundColor = 'white';

    // Größe des Viewports an Fenster anpassen, dann Canvas-Buffer setzen
    adjustCanvasViewportSize();
    resizeDrawingCanvas();

    layers = [];
    addLayer('Layer 1');
    currentLayerIndex = 0;
    updateLayersPanel();
    renderDrawingCanvas();
    updatePreview();
    updateTransformStyle();

    // Positioniere das 'Weitere Einstellungen' Panel an der richtigen Stelle
    syncOtherControlsPanel();
}

// Verschiebe das "other-controls-panel" ins linke Sidebar- bzw. zurück ans Ende des Grid für Mobile. Dadurch erscheint es direkt unter
// den Pinsel-Tools in Querformat und ganz unten im Hochformat.
function syncOtherControlsPanel() {
    const panel = document.querySelector('.other-controls-panel');
    const sidebarLeft = document.querySelector('.sidebar-left');
    const appGrid = document.querySelector('.app-grid');
    if (!panel || !sidebarLeft || !appGrid) return;

    const isMobile = window.matchMedia('(max-width: 980px)').matches;

    if (isMobile) {
        // mobile: sollte ganz unten im Grid stehen
        if (panel.parentElement !== appGrid) {
            appGrid.appendChild(panel);
        }
        panel.style.maxWidth = '';
        panel.style.width = '';
        panel.style.position = '';
        panel.style.marginTop = '12px';
    } else {
        // desktop: direkt unterhalb der linken Sidebar-Tools
        if (panel.parentElement !== sidebarLeft) {
            sidebarLeft.appendChild(panel);
        }
        // stelle sicher, dass es optisch zur Sidebar passt
        panel.style.maxWidth = '100%';
        panel.style.width = '';
        panel.style.position = '';
        panel.style.marginTop = '12px';
    }
}

// ensure canvas resizes with window
window.addEventListener('resize', () => {
    clearTimeout(window.__resizeTimeoutPreview);
    window.__resizeTimeoutPreview = setTimeout(() => {
        adjustCanvasViewportSize();
        resizeDrawingCanvas();
        // reposition the other-controls panel after layout changes
        syncOtherControlsPanel();
    }, 120);
});

// also react to orientation changes / media query changes
const mq = window.matchMedia('(max-width: 980px)');
if (mq.addEventListener) {
    mq.addEventListener('change', () => syncOtherControlsPanel());
} else if (mq.addEventListener) {
    mq.addEventListener(() => syncOtherControlsPanel());
}

// Exponierte Funktionen (für onclicks)
window.addLayer = addLayer;
window.deleteLayer = deleteLayer;
window.copyLayer = copyLayer;
window.setLayerOpacity = setLayerOpacity;
window.toggleLayerVisibility = toggleLayerVisibility;
window.clearDrawing = clearDrawing;
window.downloadImage = downloadImage;
window.downloadLayers = downloadLayers;
window.setTool = setTool;
window.undo = undo;
window.redo = redo;

initializeCanvases();