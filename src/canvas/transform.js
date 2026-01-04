export function screenToCanvasCoords(drawingCanvas, clientX, clientY) {
    const rect = drawingCanvas.getBoundingClientRect(); // CSS px
    const scaleX = drawingCanvas.width / rect.width;
    const scaleY = drawingCanvas.height / rect.height;
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;
    return { x: cssX * scaleX, y: cssY * scaleY };
}

export function softClamp(value, min, max, tolerance) {
    if (value < min) {
        const d = min - value;
        return d > tolerance ? min - tolerance : min - d;
    }
    if (value > max) {
        const d = value - max;
        return d > tolerance ? max + tolerance : max + d;
    }
    return value;
}

export function clampPan(viewportEl, drawingCanvas, offsetX, offsetY, tolerance) {
    const viewW = viewportEl.clientWidth;
    const viewH = viewportEl.clientHeight;

    const canvasRect = drawingCanvas.getBoundingClientRect();
    const canvasW = canvasRect.width;
    const canvasH = canvasRect.height;

    let nx = offsetX;
    let ny = offsetY;

    if (canvasW < viewW) nx = (viewW - canvasW) / 2;
    else nx = softClamp(nx, viewW - canvasW, 0, tolerance);

    if (canvasH < viewH) ny = (viewH - canvasH) / 2;
    else ny = softClamp(ny, viewH - canvasH, 0, tolerance);

    return { offsetX: nx, offsetY: ny };
}