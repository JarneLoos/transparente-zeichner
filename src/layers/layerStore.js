import Layer from "../layerModel.js";
import { hexToHsl, hslToHex } from "../utils/color.js";

/**
 * LayerStore kapselt:
 * - layers[] + currentLayerIndex
 * - add/copy/delete/move/select
 * - opacity/visibility/color updates
 *
 * UI/Rendering/History sind über Hooks angebunden:
 * - saveState(): optional, wird vor mutierenden Aktionen aufgerufen
 * - onChange(): optional, für UI (z.B. LayersPanel neu bauen)
 * - onRender(): optional, für Canvas/Preview neu rendern
 *
 * applySegmentClip(ctx, segmentInfo): optional, wenn du beim Neuanlegen
 * direkt clip+fill machen willst (wie aktuell).
 * getSegmentInfo(): optional, falls applySegmentClip benutzt wird.
 */
export function createLayerStore({
    canvasWidth,
    canvasHeight,
    layerHueStart = 60,
    layerHueStep = 15,
    saveState = null,
    onChange = null,
    onRender = null,
    applySegmentClip = null,
    getSegmentInfo = null
} = {}) {
    if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) {
        throw new Error("createLayerStore: canvasWidth/canvasHeight required");
    }

    /** @type {Layer[]} */
    let layers = [];
    let currentLayerIndex = 0;

    function notifyChanged() {
        if (typeof onChange === "function") onChange(getState());
    }

    function notifyRender() {
        if (typeof onRender === "function") onRender(getState());
    }

    function snapshotBeforeMutation(dontSaveState) {
        if (!dontSaveState && typeof saveState === "function") saveState();
    }

    function getState() {
        return {
            layers,
            currentLayerIndex
        };
    }

    function getLayers() {
        return layers;
    }

    function getCurrentLayerIndex() {
        return currentLayerIndex;
    }

    function getCurrentLayer() {
        return layers[currentLayerIndex] ?? null;
    }

    function selectLayer(index) {
        if (!Number.isInteger(index)) return;
        if (index < 0 || index >= layers.length) return;
        currentLayerIndex = index;
        notifyChanged();
        notifyRender();
    }

    function nextAutoColor() {
        if (layers.length === 0) {
            // first layer starts at yellow-ish (like your current logic)
            return hslToHex(`hsl(${layerHueStart}, 100%, 50%)`);
        }

        const lastColor = layers[layers.length - 1].color;
        const hsl = hexToHsl(lastColor);
        const newHue = (hsl.h - layerHueStep + 360) % 360;
        return hslToHex(`hsl(${newHue}, ${hsl.s}%, ${hsl.l}%)`);
    }

    function initLayerCanvas(layer) {
        // Support both: Layer creates its own canvas, or not.
        if (!layer.canvas) {
            layer.canvas = document.createElement("canvas");
        }
        layer.canvas.width = canvasWidth;
        layer.canvas.height = canvasHeight;
        layer.ctx = layer.canvas.getContext("2d", { willReadFrequently: true });
        if (!layer.ctx) throw new Error("Failed to get 2d context for layer");
    }

    function fillNewLayer(layer) {
        if (!layer.ctx) return;

        // Optional: clip to segment like current behavior (if wired up)
        if (typeof applySegmentClip === "function") {
            layer.ctx.save();

            if (typeof getSegmentInfo === "function") {
                const info = getSegmentInfo();
                applySegmentClip(layer.ctx, info);
            } else {
                // If caller provides a clip function that doesn't need info
                applySegmentClip(layer.ctx);
            }

            layer.ctx.fillStyle = layer.color;
            layer.ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
            layer.ctx.restore();
            return;
        }

        // Default: fill full layer
        layer.ctx.save();
        layer.ctx.fillStyle = layer.color;
        layer.ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
        layer.ctx.restore();
    }

    function addLayer({
        name = null,
        opacity = 0.5,
        visible = true,
        color = null,
        canvas = null,
        dontSaveState = false
    } = {}) {
        snapshotBeforeMutation(dontSaveState);

        const layerName = name ?? `Layer ${layers.length + 1}`;
        const layer = new Layer(layerName, canvasWidth, canvasHeight);

        // Ensure required fields exist
        layer.name = layerName;
        layer.opacity = typeof opacity === "number" ? opacity : 0.5;
        layer.visible = typeof visible === "boolean" ? visible : true;
        layer.color = color ?? nextAutoColor();

        if (canvas) {
            layer.canvas = canvas;
            layer.ctx = canvas.getContext("2d", { willReadFrequently: true });
        } else {
            initLayerCanvas(layer);
            fillNewLayer(layer);
        }

        layers.push(layer);
        currentLayerIndex = layers.length - 1;

        notifyChanged();
        notifyRender();
        return layer;
    }

    function deleteLayer({ dontSaveState = false } = {}) {
        if (layers.length <= 1) {
            // same rule as in your current code: at least one layer must remain
            return false;
        }

        snapshotBeforeMutation(dontSaveState);

        layers.splice(currentLayerIndex, 1);
        if (currentLayerIndex >= layers.length) currentLayerIndex = layers.length - 1;

        notifyChanged();
        notifyRender();
        return true;
    }

    function moveLayer(fromIndex, toIndex, { dontSaveState = false } = {}) {
        if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
        if (fromIndex < 0 || fromIndex >= layers.length) return;
        if (toIndex < 0 || toIndex >= layers.length) return;
        if (fromIndex === toIndex) return;

        snapshotBeforeMutation(dontSaveState);

        const [movedLayer] = layers.splice(fromIndex, 1);
        layers.splice(toIndex, 0, movedLayer);

        // keep selection stable (ported from your logic)
        if (currentLayerIndex === fromIndex) currentLayerIndex = toIndex;
        else if (fromIndex < toIndex) {
            if (currentLayerIndex > fromIndex && currentLayerIndex <= toIndex) currentLayerIndex--;
        } else {
            if (currentLayerIndex >= toIndex && currentLayerIndex < fromIndex) currentLayerIndex++;
        }

        notifyChanged();
        notifyRender();
    }

    function setLayerOpacity(index, value, { dontSaveState = false } = {}) {
        if (!Number.isInteger(index) || index < 0 || index >= layers.length) return;
        snapshotBeforeMutation(dontSaveState);

        // expects slider 0..100 or already 0..1 -> accept both
        const v = Number(value);
        layers[index].opacity = v > 1 ? v / 100 : v;

        notifyChanged();
        notifyRender();
    }

    function toggleLayerVisibility(index, visible, { dontSaveState = false } = {}) {
        if (!Number.isInteger(index) || index < 0 || index >= layers.length) return;
        snapshotBeforeMutation(dontSaveState);

        layers[index].visible = !!visible;

        notifyChanged();
        notifyRender();
    }

    function recolorLayerPixels(layer, newHexColor) {
        if (!layer?.ctx) return;

        const w = layer.canvas.width;
        const h = layer.canvas.height;

        const imageData = layer.ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        const rNew = parseInt(newHexColor.slice(1, 3), 16);
        const gNew = parseInt(newHexColor.slice(3, 5), 16);
        const bNew = parseInt(newHexColor.slice(5, 7), 16);

        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha !== 0) {
                data[i + 0] = rNew;
                data[i + 1] = gNew;
                data[i + 2] = bNew;
            }
        }

        layer.ctx.putImageData(imageData, 0, 0);
    }

    function setLayerColor(index, color, { dontSaveState = false, recolorPixels = true } = {}) {
        if (!Number.isInteger(index) || index < 0 || index >= layers.length) return;
        if (typeof color !== "string") return;
        snapshotBeforeMutation(dontSaveState);

        const layer = layers[index];
        layer.color = color;

        if (recolorPixels) recolorLayerPixels(layer, color);

        notifyChanged();
        notifyRender();
    }

    function copyLayer({ dontSaveState = false } = {}) {
        if (layers.length === 0) return null;

        snapshotBeforeMutation(dontSaveState);

        const src = getCurrentLayer();
        if (!src) return null;

        // Name logic like your current code: "BaseName N"
        const baseName = (src.name || "Layer").replace(/\d+$/, "").trim();
        const re = new RegExp(`^${escapeRegExp(baseName)}\\s*(\\d+)?$`);
        let maxIndex = 0;

        for (const l of layers) {
            const m = (l.name || "").match(re);
            if (m) {
                const n = parseInt(m[1], 10);
                if (!Number.isNaN(n)) maxIndex = Math.max(maxIndex, n);
            }
        }

        const copyName = `${baseName} ${maxIndex + 1}`;

        const newLayer = new Layer(copyName, canvasWidth, canvasHeight);
        newLayer.name = copyName;
        newLayer.opacity = src.opacity;
        newLayer.visible = src.visible;
        newLayer.color = nextAutoColor();

        initLayerCanvas(newLayer);

        // copy pixel data
        newLayer.ctx.clearRect(0, 0, newLayer.canvas.width, newLayer.canvas.height);
        newLayer.ctx.drawImage(src.canvas, 0, 0, src.canvas.width, src.canvas.height, 0, 0, newLayer.canvas.width, newLayer.canvas.height);

        // recolor to newLayer.color (like your current behavior)
        try {
            recolorLayerPixels(newLayer, newLayer.color);
        } catch {
            // ignore, keep as-is
        }

        const insertIndex = currentLayerIndex + 1;
        layers.splice(insertIndex, 0, newLayer);
        currentLayerIndex = insertIndex;

        notifyChanged();
        notifyRender();
        return newLayer;
    }

    function escapeRegExp(s) {
        return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function replaceAllLayers(newLayers, newCurrentIndex = 0, { dontSaveState = true } = {}) {
        snapshotBeforeMutation(dontSaveState);
        layers = Array.isArray(newLayers) ? newLayers : [];
        currentLayerIndex = Math.max(0, Math.min(newCurrentIndex, layers.length - 1));
        notifyChanged();
        notifyRender();
    }

    return {
        // state
        getState,
        getLayers,
        getCurrentLayerIndex,
        getCurrentLayer,

        // actions
        selectLayer,
        addLayer,
        deleteLayer,
        copyLayer,
        moveLayer,
        setLayerOpacity,
        toggleLayerVisibility,
        setLayerColor,
        replaceAllLayers
    };
}