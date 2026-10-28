(function (root) {
  const reserved = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(?:\.|$)/i;
  function safePart(value) {
    let result = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 72).replace(/[. ]+$/g, '');
    if (!result) result = 'Без названия';
    if (reserved.test(result)) result = result.replace(/^([^.]+)(?=\.|$)/, '$1_').slice(0, 72).replace(/[. ]+$/g, '');
    return result;
  }
  function validateExportName(value) {
    if (typeof value !== 'string') throw Error('Некорректное название папки.');
    const name = value.trim().replace(/\s+/g, ' ');
    if (!name) return '';
    if (name.length > 72) throw Error('Название папки должно быть не длиннее 72 символов.');
    if (/[<>:"/\\|?*\x00-\x1f]/.test(value) || /\.$/.test(name) || reserved.test(name)) throw Error('Название содержит запрещённые символы или зарезервировано Windows.');
    return name;
  }
  const api = { safePart, validateExportName };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FolderName = api;
})(globalThis);
