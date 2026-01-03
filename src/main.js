import {
    initialize,
    addLayer,
    deleteLayer,
    copyLayer,
    setLayerOpacity,
    toggleLayerVisibility,
    clearDrawing,
    loadProjectFromBrowser,
    importProject,
    openExportPopup,
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
    clearDrawing,
    loadProjectFromBrowser,
    importProject,
    openExportPopup,
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
