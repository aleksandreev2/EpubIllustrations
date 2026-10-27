# Сторонние компоненты

Код приложения и демонстрационные иллюстрации распространяются по MIT.
Сторонние компоненты сохраняют собственные лицензии.

| Компонент | Назначение | Лицензия |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) 33.4.11 | Окно приложения и среда исполнения | MIT; дополнительные лицензии Chromium и Node.js |
| [fflate](https://github.com/101arrowz/fflate) 0.8.3 | Чтение EPUB и запись ZIP | MIT |
| [electron-builder](https://github.com/electron-userland/electron-builder) 25.1.8 | Сборка установщика и переносимого EXE | MIT, инструмент разработки |

В Windows-сборку входят `LICENSE.electron.txt` и `LICENSES.chromium.html`,
создаваемые инструментом упаковки. Лицензия fflate находится в пакете
`node_modules/fflate/LICENSE` внутри ресурсов приложения. Системные шрифты
Windows используются без включения файлов шрифтов в дистрибутив.

## fflate — MIT

Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
