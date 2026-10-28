(function (root) {
  const defaults = { format: 'original', quality: 85, maxDimension: 0 };
  function normalizeImageOptions(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Некорректные параметры изображения.');
    const options = { ...defaults, ...value };
    if (!['original', 'webp', 'jpeg', 'png'].includes(options.format)) throw Error('Неизвестный формат изображения.');
    if (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100) throw Error('Качество должно быть от 1 до 100.');
    if (!Number.isInteger(options.maxDimension) || options.maxDimension < 0 || options.maxDimension > 8192) throw Error('Размер должен быть от 0 до 8192 пикселей.');
    return { format: options.format, quality: options.quality, maxDimension: options.maxDimension };
  }
  function fitImageDimensions(width, height, maximum) {
    if (![width, height].every(value => Number.isInteger(value) && value > 0) || !Number.isInteger(maximum) || maximum < 0) throw Error('Некорректные размеры изображения.');
    const scale = maximum ? Math.min(1, maximum / Math.max(width, height)) : 1;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }
  function describeImageOptions(value) {
    const options = normalizeImageOptions(value);
    if (options.format === 'original') return 'Оригинал';
    const name = { webp: 'WebP', jpeg: 'JPEG', png: 'PNG' }[options.format];
    return `${name}${options.format === 'png' ? ' · без потерь' : ` · ${options.quality}%`}${options.maxDimension ? ` · до ${options.maxDimension} px` : ' · исходный размер'}`;
  }
  const api = { normalizeImageOptions, fitImageDimensions, describeImageOptions };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImageOptions = api;
})(globalThis);
