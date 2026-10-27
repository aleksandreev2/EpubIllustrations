(function (root) {
  function fitScale(width, height, viewportWidth, viewportHeight, rotation = 0) {
    if (![width, height, viewportWidth, viewportHeight].every(value => Number.isFinite(value) && value > 0)) return 1;
    const sideways = ((rotation % 180) + 180) % 180 === 90;
    const rotatedWidth = sideways ? height : width;
    const rotatedHeight = sideways ? width : height;
    return Math.min(1, Math.max(1, viewportWidth - 32) / rotatedWidth, Math.max(1, viewportHeight - 32) / rotatedHeight);
  }

  function zoomAround(x, y, pointerX, pointerY, oldScale, newScale) {
    const ratio = newScale / oldScale;
    return { x: pointerX - (pointerX - x) * ratio, y: pointerY - (pointerY - y) * ratio };
  }

  const api = { fitScale, zoomAround };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ViewerMath = api;
})(typeof window === 'undefined' ? null : window);
