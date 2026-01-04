export default class Layer {
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