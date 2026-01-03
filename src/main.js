import {
    initialize,
    addLayer,
    deleteLayer,
    copyLayer,
    setLayerOpacity,
    toggleLayerVisibility,
    applyColor,
    clearDrawing,
    loadProjectFromBrowser,
    importProject,
    openColorPopup,
    closeColorPopup,
    openImportPopup,
    closeImportPopup,
    openExportPopup,
    closeExportPopup,
    saveProjectInBrowser,
    exportAsJSON,
    exportAsPNG,
    exportLayersAsPNG,
    setTool,
    undo,
    redo
} from "./app/app.js";

Object.assign(window, {
    addLayer,
    deleteLayer,
    copyLayer,
    setLayerOpacity,
    toggleLayerVisibility,
    applyColor,
    clearDrawing,
    loadProjectFromBrowser,
    importProject,
    openColorPopup,
    closeColorPopup,
    openImportPopup,
    closeImportPopup,
    openExportPopup,
    closeExportPopup,
    saveProjectInBrowser,
    exportAsJSON,
    exportAsPNG,
    exportLayersAsPNG,
    setTool,
    undo,
    redo
});

window.addEventListener("DOMContentLoaded", () => {
    initialize();
});
