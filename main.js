        const drawingCanvas = document.getElementById('drawingCanvas');
        const previewCanvas = document.getElementById('previewCanvas');
        const ctx = drawingCanvas.getContext('2d');
        const previewCtx = previewCanvas.getContext('2d');

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
        let currentTool = 'brush';
        let startX = 0;
        let startY = 0;
        let previewImageData = null;

        let showGuides = true;

        // Touch / Pinch state
        let isPinching = false;
        let pinchData = null; // { startDist, initialScale, panOriginOffsetX, panOriginOffsetY, startCenterClientX, startCenterClientY }

        // Ebenen-Verwaltung
        let layers = [];
        let currentLayerIndex = 0;

        // Segment offset
        let segOffX = -50;
        let segOffY = 100;

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

        function updateTransformStyle() {
            // apply CSS transform: translate(px, px) scale(s)
            drawingCanvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
            // show appropriate cursor
            if (isPanning) {
                drawingCanvas.style.cursor = 'grabbing';
            } else {
                drawingCanvas.style.cursor = 'crosshair';
            }
        }

        function screenToCanvasCoords(clientX, clientY) {
            const rect = drawingCanvas.getBoundingClientRect();

            // CSS-Pixel → Canvas-Pixel
            const scaleX = drawingCanvas.width / rect.width;
            const scaleY = drawingCanvas.height / rect.height;

            const cssX = clientX - rect.left;
            const cssY = clientY - rect.top;

            const x = cssX * scaleX;
            const y = cssY * scaleY;

            return { x, y };
        }


        // --- Rendering: Zusammensetzen des sichtbaren drawingCanvas ---
        function renderDrawingCanvas() {
            // draw onto the canvas pixel buffer (independent of CSS transform)
            ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
            ctx.fillStyle = canvasBgColor;
            ctx.fillRect(0, 0, drawingCanvas.width, drawingCanvas.height);

            for (let i = 0; i < layers.length; i++) {
                const layer = layers[i];
                if (!layer.visible) continue;
                ctx.globalAlpha = layer.opacity;
                ctx.drawImage(layer.canvas, 0, 0);
            }
            ctx.globalAlpha = 1;

            drawSegmentGuideOverlay();
        }

        function drawSegmentGuideOverlay() {
            const segments = parseInt(segmentsInput.value);
            const centerX = drawingCanvas.width / 2 + segOffX;
            const centerY = drawingCanvas.height / 2 + segOffY;
            const radius = Math.min(drawingCanvas.width, drawingCanvas.height) / 2;
            const anglePerSegment = (Math.PI * 2) / segments;
            const startAngle = -Math.PI / 2;

            ctx.save();

            // Ränder / Bogen zeichnen
            ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
            ctx.lineWidth = 2;

            if (showGuides) {
                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.lineTo(
                    centerX + radius * Math.cos(startAngle),
                    centerY + radius * Math.sin(startAngle)
                );
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(centerX, centerY);
                ctx.lineTo(
                    centerX + radius * Math.cos(startAngle + anglePerSegment),
                    centerY + radius * Math.sin(startAngle + anglePerSegment)
                );
                ctx.stroke();
            }

            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, startAngle, startAngle + anglePerSegment);
            ctx.stroke();

            ctx.restore();
        }

        // Vorschau (Kaleidoskop) aktualisieren — nutzt drawingCanvas (untransformed)
        function updatePreview() {
            const segments = parseInt(segmentsInput.value);
            const centerX = previewCanvas.width / 2;
            const centerY = previewCanvas.height / 2;
            const radius = Math.min(previewCanvas.width, previewCanvas.height) / 2;

            previewCtx.fillStyle = canvasBgColor;
            previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

            const anglePerSegment = (Math.PI * 2) / segments;
            const startAngle = -Math.PI / 2;

            for (let i = 0; i < segments; i++) {
                previewCtx.save();
                previewCtx.translate(centerX, centerY);
                previewCtx.rotate(anglePerSegment * i);

                if (i % 2 === 1) {
                    previewCtx.rotate(anglePerSegment / 2);
                    previewCtx.scale(-1, 1);
                    previewCtx.rotate(-anglePerSegment / 2);
                }

                previewCtx.translate(-centerX, -centerY);

                previewCtx.save();
                previewCtx.beginPath();
                previewCtx.moveTo(centerX, centerY);
                previewCtx.lineTo(
                    centerX + radius * Math.cos(startAngle),
                    centerY + radius * Math.sin(startAngle)
                );
                previewCtx.arc(centerX, centerY, radius, startAngle, startAngle + anglePerSegment);
                previewCtx.closePath();
                previewCtx.clip();

                previewCtx.drawImage(drawingCanvas, -segOffX, -segOffY);
                previewCtx.restore();
                previewCtx.restore();
            }
        }

        // Ebenen-Funktionen (UI bleibt gleich)
        function addLayer(name = null) {
            if (!name) name = `Ebene ${layers.length + 1}`;
            const layer = new Layer(name);
            const hue = (layers.length * 30) % 360;
            const hslColor = `hsl(${hue}, 70%, 50%)`;
            layer.color = hslToHex(hslColor);

            layers.push(layer);
            currentLayerIndex = layers.length - 1;
            updateLayersPanel();
            renderDrawingCanvas();
            updatePreview();
        }

        function deleteLayer() {
            if (layers.length <= 1) {
                alert('Du musst mindestens eine Ebene haben!');
                return;
            }
            layers.splice(currentLayerIndex, 1);
            if (currentLayerIndex >= layers.length) currentLayerIndex = layers.length - 1;
            updateLayersPanel();
            renderDrawingCanvas();
            updatePreview();
        }

        function updateLayersPanel() {
            const panel = document.getElementById('layersPanel');
            panel.innerHTML = '';

            for (let i = layers.length - 1; i >= 0; i--) {
                const layer = layers[i];

                // Zeile 1: Titel + Farbe
                const topRow = document.createElement('div');
                topRow.className = 'layer-top';

                const title = document.createElement('div');
                title.className = 'layer-title';
                title.textContent = layer.name;

                const colorInput = document.createElement('input');
                colorInput.type = 'color';
                colorInput.value = layer.color;
                colorInput.addEventListener('change', () => setLayerColor(i, colorInput.value));
                colorInput.addEventListener('click', e => e.stopPropagation());
                colorInput.addEventListener('mousedown', e => e.stopPropagation());

                topRow.appendChild(title);
                topRow.appendChild(colorInput);

                // Zeile 2: Checkbox + Slider
                const bottomRow = document.createElement('div');
                bottomRow.className = 'layer-bottom';

                const visibilityCheckbox = document.createElement('input');
                visibilityCheckbox.type = 'checkbox';
                visibilityCheckbox.checked = layer.visible;
                visibilityCheckbox.addEventListener('change', () => toggleLayerVisibility(i, visibilityCheckbox.checked));
                visibilityCheckbox.addEventListener('click', e => e.stopPropagation());
                visibilityCheckbox.addEventListener('mousedown', e => e.stopPropagation());

                const opacitySlider = document.createElement('input');
                opacitySlider.type = 'range';
                opacitySlider.min = '0';
                opacitySlider.max = '100';
                opacitySlider.value = Math.round(layer.opacity * 100);
                opacitySlider.addEventListener('input', () => setLayerOpacity(i, opacitySlider.value));
                opacitySlider.addEventListener('click', e => e.stopPropagation());
                opacitySlider.addEventListener('mousedown', e => e.stopPropagation());

                bottomRow.appendChild(visibilityCheckbox);
                bottomRow.appendChild(opacitySlider);

                // Container für Inhalt (ohne Drag Handle)
                const contentContainer = document.createElement('div');
                contentContainer.style.display = 'flex';
                contentContainer.style.flexDirection = 'column';
                contentContainer.style.flex = '1';

                contentContainer.appendChild(topRow);
                contentContainer.appendChild(bottomRow);

                // Drag Handle rechts, volle Höhe
                const dragHandle = document.createElement('div');
                dragHandle.className = 'layer-drag-handle';
                dragHandle.textContent = '⋮⋮';
                dragHandle.draggable = true;

                // Haupt-Container mit Flexbox
                const layerItem = document.createElement('div');
                layerItem.className = `layer-item ${i === currentLayerIndex ? 'active' : ''}`;
                layerItem.dataset.index = i;
                layerItem.style.display = 'flex';
                layerItem.style.alignItems = 'stretch';

                layerItem.appendChild(contentContainer);
                layerItem.appendChild(dragHandle);

                // Drag Events nur Handle
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

                // Auswahl durch Klick (außer auf Inputs/Handle)
                layerItem.addEventListener('click', ev => {
                    if (ev.target.tagName === 'INPUT' || ev.target.classList.contains('layer-drag-handle')) return;
                    selectLayer(i);
                });

                // Drop-Zonen
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

                panel.appendChild(layerItem);
            }
        }

        function selectLayer(index) {
            currentLayerIndex = index;
            updateLayersPanel();
        }

        function setLayerOpacity(index, value) {
            layers[index].opacity = value / 100;
            renderDrawingCanvas();
            updatePreview();
        }

        function toggleLayerVisibility(index, visible) {
            layers[index].visible = visible;
            renderDrawingCanvas();
            updatePreview();
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

        // Segment clipping for per-layer drawing
        function applySegmentClip(ctx) {
            const segments = parseInt(segmentsInput.value);
            const cx = drawingCanvas.width / 2 + segOffX;
            const cy = drawingCanvas.height / 2 + segOffY;
            const r = Math.min(drawingCanvas.width / 2, cy);
            const anglePerSegment = (Math.PI * 2) / segments;
            const startAngle = -Math.PI / 2;

            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + r * Math.cos(startAngle), cy + r * Math.sin(startAngle));
            ctx.arc(cx, cy, r, startAngle, startAngle + anglePerSegment);
            ctx.closePath();
            ctx.clip();
        }

        function isPointInSegment(x, y) {
            x -= segOffX
            y -= segOffY;

            const cx = drawingCanvas.width / 2;
            const cy = drawingCanvas.height / 2;

            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const radius = Math.min(cx, cy);
            if (dist > radius) return false;

            let angle = Math.atan2(dy, dx);
            // Normalize angle to [-PI, PI). Our startAngle is -PI/2
            // Shift negative angles upward for consistency
            while (angle < -Math.PI / 2) angle += Math.PI * 2;
            const segments = parseInt(segmentsInput.value);
            const anglePerSegment = (Math.PI * 2) / segments;
            const startAngle = -Math.PI / 2;
            const endAngle = startAngle + anglePerSegment;

            return angle >= startAngle && angle <= endAngle;
        }

        function hslToHex(hsl) {
            const hslRegex = /hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/i;
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

            const canvasW = drawingCanvas.width * scale;
            const canvasH = drawingCanvas.height * scale;

            const TOLERANCE = 200; // <<< Gummirand in Pixeln

            // Horizontal
            if (canvasW <= viewW) {
                offsetX = (viewW - canvasW) / 2;
            } else {
                const minX = viewW - canvasW;
                const maxX = 0;
                offsetX = softClamp(offsetX, minX, maxX, TOLERANCE);
            }

            // Vertikal
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

        // --- Zeichnen: Event-Handler (jetzt mit transform-aware Koordinaten) ---
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

        // initialer Wert (aus Picker)
        let canvasBgColor = bgColorPicker.value;

        // setze die CSS-Hintergründe sofort (sichtbar ohne Neuzeichnen)
        drawingCanvas.style.backgroundColor = canvasBgColor;
        previewCanvas.style.backgroundColor = canvasBgColor;

        // Event: live update wenn Farbe gewechselt wird
        bgColorPicker.addEventListener('input', () => {
            canvasBgColor = bgColorPicker.value;
            drawingCanvas.style.backgroundColor = canvasBgColor;
            previewCanvas.style.backgroundColor = canvasBgColor;

            // Wenn du beim Clear explizit mit Farbe füllst, neu rendern:
            renderDrawingCanvas(); // deine Funktion, die das drawing-Canvas neu zeichnet
            updatePreview();       // deine Preview-Update-Funktion
        });

        const showGuidesInput = document.getElementById('showGuides');
        showGuidesInput.addEventListener('change', function () {
            showGuides = this.checked;
            renderDrawingCanvas();
            updatePreview();
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

            const maxPixels = 200000;
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
            link.download = 'kaleidoskop.png';
            link.href = previewCanvas.toDataURL();
            link.click();
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
    drawingCanvas.style.backgroundColor = 'white';
    previewCanvas.style.backgroundColor = 'white';
    layers = [];
    addLayer('Ebene 1');
    currentLayerIndex = 0;
    updateLayersPanel();
    renderDrawingCanvas();
    updatePreview();
    updateTransformStyle();
}

        // Exponierte Funktionen (für onclicks)
        window.addLayer = addLayer;
        window.deleteLayer = deleteLayer;
        window.setLayerOpacity = setLayerOpacity;
        window.toggleLayerVisibility = toggleLayerVisibility;
        window.clearDrawing = clearDrawing;
        window.downloadImage = downloadImage;
        window.setTool = setTool;
        window.undo = undo;
        window.redo = redo;

initializeCanvases();