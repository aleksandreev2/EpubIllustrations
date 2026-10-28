// Runs in an isolated, sandboxed window with no network or Node.js access.
window.convertIllustration = async function (base64, sourceMime, settings) {
  const options = ImageOptions.normalizeImageOptions(settings);
  const mime = { webp: 'image/webp', jpeg: 'image/jpeg', png: 'image/png' }[options.format];
  if (!mime) throw Error('Выберите формат преобразования.');
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: sourceMime }));
  const image = new Image();
  let canvas;
  try {
    image.src = url;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width * height > 100000000) throw Error('Изображение слишком большое для преобразования. Выберите «Оригинал».');
    const size = ImageOptions.fitImageDimensions(width, height, options.maxDimension);
    // Chromium silently crops WebP above its 16383 px codec limit.
    if (options.format === 'webp' && Math.max(size.width, size.height) > 16383) throw Error('WebP поддерживает сторону до 16383 пикселей. Выберите ограничение размера или другой формат.');
    if (Math.max(size.width, size.height) > 32767) throw Error('Для преобразования такой длинной картинки выберите ограничение размера.');
    canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw Error('Не удалось подготовить изображение.');
    if (options.format === 'jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, size.width, size.height); }
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    // createImageBitmap decodes the default (first) animation frame.
    let bitmap;
    try { bitmap = await createImageBitmap(new Blob([bytes], { type: sourceMime })); } catch { /* SVG uses the decoded Image instead. */ }
    try { context.drawImage(bitmap || image, 0, 0, size.width, size.height); }
    finally { bitmap?.close(); }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, options.quality / 100));
    if (!blob || blob.type !== mime) throw Error('Кодек выбранного формата недоступен.');
    return await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(Error('Не удалось прочитать результат.'));
      reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob);
    });
  } finally {
    image.src = ''; URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
};
