export function getInfo(canvasWidth, canvasHeight, segments, segOffX, segOffY, radiusFactor) {
    const cx = canvasWidth / 2 + (segOffX ?? 0);
    const cy = canvasHeight / 2 + (segOffY ?? 0);
    const radius = Math.min(canvasWidth, canvasHeight) * 0.5 * radiusFactor;
    const anglePerSegment = (Math.PI * 2) / Math.max(1, segments);
    const startAngle = -Math.PI / 2;
    return { segments, cx, cy, radius, anglePerSegment, startAngle };
}

export function applyClip(ctx, info) {
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

export function isPointInSegment(x, y, info) {
    const dx = x - info.cx;
    const dy = y - info.cy;
    const dist = Math.hypot(dx, dy);
    if (dist > info.radius) return false;

    let angle = Math.atan2(dy, dx);
    let rel = angle - info.startAngle;
    while (rel < 0) rel += Math.PI * 2;
    while (rel > Math.PI * 2) rel -= Math.PI * 2;
    return rel >= 0 && rel <= info.anglePerSegment;
}
