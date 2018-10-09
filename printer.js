
const { MutableBuffer } = require('mutable-buffer');
const iconv = require('iconv-lite');
const _ = require('./commands');
const utils = require('./utils');
const Image = require('./image');

function Printer() {
    this.buffer = new MutableBuffer();
    this.encoding = 'UTF-8';
}

Printer.prototype.encode = function (encoding) {
    this.encoding = encoding;
    return this;
}

Printer.prototype.raster = function (image, mode) {
    if (!(image instanceof Image))
      throw new TypeError('Only escpos.Image supported');
    mode = mode || 'normal';
    if (mode === 'dhdw' ||
      mode === 'dwh' ||
      mode === 'dhw') mode = 'dwdh';
    var raster = image.toRaster();
    var header = _.GSV0_FORMAT['GSV0_' + mode.toUpperCase()];
    this.buffer.write(header);
    this.buffer.writeUInt16LE(raster.width);
    this.buffer.writeUInt16LE(raster.height);
    this.buffer.write(raster.data);
    return this;
};

Printer.prototype.image = function (image, density) {
    if (!(image instanceof Image))
      throw new TypeError('Only escpos.Image supported');
    density = density || 'd24';
    var n = !!~['d8', 's8'].indexOf(density) ? 1 : 3;
    var header = _.BITMAP_FORMAT['BITMAP_' + density.toUpperCase()];
    var bitmap = image.toBitmap(n * 8);
    var self = this;
  
    // added a delay so the printer can process the graphical data
    // when connected via slower connection ( e.g.: Serial)
    bitmap.data.forEach(async (line) => {
      self.buffer.write(header);
      self.buffer.writeUInt16LE(line.length / n);
      self.buffer.write(line);
      self.buffer.write(_.ESC + _.FEED_CONTROL_SEQUENCES.CTL_GLF);
      await new Promise((resolve, reject) => {
        setTimeout(() => { resolve(true) }, 200);
      });
    });
  
    return this;
};

Printer.prototype.text = function (content) {
    this.print(iconv.encode(content + _.EOL, this.encoding));
    return this;
};

Printer.prototype.pureText = function (content, encoding) {
    return this.print(iconv.encode(content, encoding || this.encoding));
};

Printer.prototype.marginRight = function (size) {
    this.buffer.write(_.MARGINS.RIGHT);
    this.buffer.writeUInt8(size);
    return this;
};

Printer.prototype.beep = function (n, t) {
    this.buffer.write(_.BEEP);
    this.buffer.writeUInt8(n);
    this.buffer.writeUInt8(t);
    return this;
};

Printer.prototype.hardware = function (hw) {
    this.buffer.write(_.HARDWARE['HW_' + hw.toUpperCase()]);
    return this;
};

Printer.prototype.marginBottom = function (size) {
    this.buffer.write(_.MARGINS.BOTTOM);
    this.buffer.writeUInt8(size);
    return this;
};

Printer.prototype.marginLeft = function (size) {
    this.buffer.write(_.MARGINS.LEFT);
    this.buffer.writeUInt8(size);
    return this;
};

Printer.prototype.print = function (content) {
    this.buffer.write(content);
    return this;
};

Printer.prototype.println = function (content) {
    return this.print(content + _.EOL);
};


Printer.prototype.build = function () {
    return this.buffer.flush();
};

Printer.prototype.font = function (family) {
    this.buffer.write(_.TEXT_FORMAT[
      'TXT_FONT_' + family.toUpperCase()
    ]);
    return this;
};

Printer.prototype.color = function (color) {
    this.buffer.write(_.COLOR[
      color === 0 || color === 1 ? color: 0
    ]);
    return this;
};

Printer.prototype.barcode = function (code, type, options) {
    options = options || {};
    var width, height, position, font, includeParity;
    if (typeof width === 'string' || typeof width === 'number') { // That's because we are not using the options.object
      width = arguments[2];
      height = arguments[3];
      position = arguments[4];
      font = arguments[5];
    } else {
      width = options.width;
      height = options.height;
      position = options.position;
      font = options.font;
      includeParity = options.includeParity !== false; // true by default
    }
  
    type = type || 'EAN13'; // default type is EAN13, may a good choice ?
    var convertCode = String(code), parityBit = '', codeLength = '';
    if (typeof type === 'undefined' || type === null) {
      throw new TypeError('barcode type is required');
    }
    if (type === 'EAN13' && convertCode.length !== 12) {
      throw new Error('EAN13 Barcode type requires code length 12');
    }
    if (type === 'EAN8' && convertCode.length !== 7) {
      throw new Error('EAN8 Barcode type requires code length 7');
    }
    if (this._model === 'qsprinter') {
      this.buffer.write(_.MODEL.QSPRINTER.BARCODE_MODE.ON);
    }
    if (this._model === 'qsprinter') {
      // qsprinter has no BARCODE_WIDTH command (as of v7.5)
    } else if (width >= 2 || width <= 6) {
      this.buffer.write(_.BARCODE_FORMAT.BARCODE_WIDTH[width]);
    } else {
      this.buffer.write(_.BARCODE_FORMAT.BARCODE_WIDTH_DEFAULT);
    }
    if (height >= 1 || height <= 255) {
      this.buffer.write(_.BARCODE_FORMAT.BARCODE_HEIGHT(height));
    } else {
      if (this._model === 'qsprinter') {
        this.buffer.write(_.MODEL.QSPRINTER.BARCODE_HEIGHT_DEFAULT);
      } else {
        this.buffer.write(_.BARCODE_FORMAT.BARCODE_HEIGHT_DEFAULT);
      }
    }
    if (this._model === 'qsprinter') {
      // Qsprinter has no barcode font
    } else {
      this.buffer.write(_.BARCODE_FORMAT[
        'BARCODE_FONT_' + (font || 'A').toUpperCase()
      ]);
    }
    this.buffer.write(_.BARCODE_FORMAT[
      'BARCODE_TXT_' + (position || 'BLW').toUpperCase()
    ]);
    this.buffer.write(_.BARCODE_FORMAT[
      'BARCODE_' + ((type || 'EAN13').replace('-', '_').toUpperCase())
    ]);
    if (type === 'EAN13' || type === 'EAN8') {
      parityBit = utils.getParityBit(code);
    }
    if (type == 'CODE128' || type == 'CODE93') {
      codeLength = utils.codeLength(code);
    }
    this.buffer.write(codeLength + code + (includeParity ? parityBit : '') + '\x00'); // Allow to skip the parity byte
    if (this._model === 'qsprinter') {
      this.buffer.write(_.MODEL.QSPRINTER.BARCODE_MODE.OFF);
    }
    return this;
};

Printer.prototype.cut = function (part, feed) {
    this.feed(feed || 3);
    this.buffer.write(_.PAPER[
      part ? 'PAPER_PART_CUT' : 'PAPER_FULL_CUT'
    ]);
    return this;
};

Printer.prototype.feed = function (n) {
    this.buffer.write(new Array(n || 1).fill(_.EOL).join(''));
    return this;
};

Printer.prototype.align = function (align) {
    this.buffer.write(_.TEXT_FORMAT[
      'TXT_ALIGN_' + align.toUpperCase()
    ]);
    return this;
};

Printer.prototype.control = function (ctrl) {
    this.buffer.write(_.FEED_CONTROL_SEQUENCES[
      'CTL_' + ctrl.toUpperCase()
    ]);
    return this;
};

Printer.prototype.spacing = function (n) {
    if (n === undefined || n === null) {
      this.buffer.write(_.CHARACTER_SPACING.CS_DEFAULT);
    } else {
      this.buffer.write(_.CHARACTER_SPACING.CS_SET);
      this.buffer.writeUInt8(n);
    }
    return this;
}

Printer.prototype.lineSpace = function (n) {
    if (n === undefined || n === null) {
      this.buffer.write(_.LINE_SPACING.LS_DEFAULT);
    } else {
      this.buffer.write(_.LINE_SPACING.LS_SET);
      this.buffer.writeUInt8(n);
    }
    return this;
};

Printer.prototype.size = function (width, height) {
    if (2 >= width && 2 >= height) {
      this.buffer.write(_.TEXT_FORMAT.TXT_NORMAL);
      if (2 == width && 2 == height) {
        this.buffer.write(_.TEXT_FORMAT.TXT_4SQUARE);
      } else if (1 == width && 2 == height) {
        this.buffer.write(_.TEXT_FORMAT.TXT_2HEIGHT);
      } else if (2 == width && 1 == height) {
        this.buffer.write(_.TEXT_FORMAT.TXT_2WIDTH);
      }
    } else {
      this.buffer.write(_.TEXT_FORMAT.TXT_CUSTOM_SIZE(width, height));
    }
    return this;
};

Printer.prototype.style = function (type) {
    switch (type.toUpperCase()) {
  
      case 'B':
        this.buffer.write(_.TEXT_FORMAT.TXT_BOLD_ON);
        this.buffer.write(_.TEXT_FORMAT.TXT_ITALIC_OFF);
        this.buffer.write(_.TEXT_FORMAT.TXT_UNDERL_OFF);
        break;
      case 'I':
        this.buffer.write(_.TEXT_FORMAT.TXT_BOLD_OFF);
        this.buffer.write(_.TEXT_FORMAT.TXT_ITALIC_ON);
        this.buffer.write(_.TEXT_FORMAT.TXT_UNDERL_OFF);
        break;
      case 'U':
        this.buffer.write(_.TEXT_FORMAT.TXT_BOLD_OFF);
        this.buffer.write(_.TEXT_FORMAT.TXT_ITALIC_OFF);
        this.buffer.write(_.TEXT_FORMAT.TXT_UNDERL_ON);
        break;
      case 'U2':
        this.buffer.write(_.TEXT_FORMAT.TXT_BOLD_OFF);
        this.buffer.write(_.TEXT_FORMAT.TXT_ITALIC_OFF);
        this.buffer.write(_.TEXT_FORMAT.TXT_UNDERL2_ON);
        break;
  
      case 'BI':
        this.buffer.write(_.TEXT_FORMAT.TXT_BOLD_ON);
        this.buffer.write(_.TEXT_FORMAT.TXT_ITALIC_ON);
        this.buffer.write(_.TEXT_FORMAT.TXT_UNDERL_OFF);
        break;
      case 'BIU':
        this.buffer.write(_.TEXT_FORMAT.TXT_BOLD_ON);
        this.buffer.write(_.TEXT_FORMAT.TXT_ITALIC_ON);
        this.buffer.write(_.TEXT_FORMAT.TXT_UNDERL_ON);
        break;
      case 'BIU2':
        this.buffer.write(_.TEXT_FORMAT.TXT_BOLD_ON);
        this.buffer.write(_.TEXT_FORMAT.TXT_ITALIC_ON);
        this.buffer.write(_.TEXT_FORMAT.TXT_UNDERL2_ON);
        break;
      case 'BU':
        this.buffer.write(_.TEXT_FORMAT.TXT_BOLD_ON);
        this.buffer.write(_.TEXT_FORMAT.TXT_ITALIC_OFF);
        this.buffer.write(_.TEXT_FORMAT.TXT_UNDERL_ON);
        break;
      case 'BU2':
        this.buffer.write(_.TEXT_FORMAT.TXT_BOLD_ON);
        this.buffer.write(_.TEXT_FORMAT.TXT_ITALIC_OFF);
        this.buffer.write(_.TEXT_FORMAT.TXT_UNDERL2_ON);
        break;
      case 'IU':
        this.buffer.write(_.TEXT_FORMAT.TXT_BOLD_OFF);
        this.buffer.write(_.TEXT_FORMAT.TXT_ITALIC_ON);
        this.buffer.write(_.TEXT_FORMAT.TXT_UNDERL_ON);
        break;
      case 'IU2':
        this.buffer.write(_.TEXT_FORMAT.TXT_BOLD_OFF);
        this.buffer.write(_.TEXT_FORMAT.TXT_ITALIC_ON);
        this.buffer.write(_.TEXT_FORMAT.TXT_UNDERL2_ON);
        break;
  
      case 'NORMAL':
      default:
        this.buffer.write(_.TEXT_FORMAT.TXT_BOLD_OFF);
        this.buffer.write(_.TEXT_FORMAT.TXT_ITALIC_OFF);
        this.buffer.write(_.TEXT_FORMAT.TXT_UNDERL_OFF);
        break;
  
    }
    return this;
};

Printer.prototype.model = function (_model) {
    this._model = _model;
    return this;
};

Printer.prototype.qrcode = function (code, version, level, size) {
    if (this._model !== 'qsprinter') {
      this.buffer.write(_.CODE2D_FORMAT.TYPE_QR);
      this.buffer.write(_.CODE2D_FORMAT.CODE2D);
      this.buffer.writeUInt8(version || 3);
      this.buffer.write(_.CODE2D_FORMAT[
        'QR_LEVEL_' + (level || 'L').toUpperCase()
      ]);
      this.buffer.writeUInt8(size || 6);
      this.buffer.writeUInt16LE(code.length);
      this.buffer.write(code);
    } else {
      const dataRaw = iconv.encode(code, 'utf8');
      if (dataRaw.length < 1 && dataRaw.length > 2710) {
        throw new Error('Invalid code length in byte. Must be between 1 and 2710');
      }
  
      // Set pixel size
      if (!size || (size && typeof size !== 'number'))
        size = _.MODEL.QSPRINTER.CODE2D_FORMAT.PIXEL_SIZE.DEFAULT;
      else if (size && size < _.MODEL.QSPRINTER.CODE2D_FORMAT.PIXEL_SIZE.MIN)
        size = _.MODEL.QSPRINTER.CODE2D_FORMAT.PIXEL_SIZE.MIN;
      else if (size && size > _.MODEL.QSPRINTER.CODE2D_FORMAT.PIXEL_SIZE.MAX)
        size = _.MODEL.QSPRINTER.CODE2D_FORMAT.PIXEL_SIZE.MAX;
      this.buffer.write(_.MODEL.QSPRINTER.CODE2D_FORMAT.PIXEL_SIZE.CMD);
      this.buffer.writeUInt8(size);
  
      // Set version
      if (!version || (version && typeof version !== 'number'))
        version = _.MODEL.QSPRINTER.CODE2D_FORMAT.VERSION.DEFAULT;
      else if (version && version < _.MODEL.QSPRINTER.CODE2D_FORMAT.VERSION.MIN)
        version = _.MODEL.QSPRINTER.CODE2D_FORMAT.VERSION.MIN;
      else if (version && version > _.MODEL.QSPRINTER.CODE2D_FORMAT.VERSION.MAX)
        version = _.MODEL.QSPRINTER.CODE2D_FORMAT.VERSION.MAX;
      this.buffer.write(_.MODEL.QSPRINTER.CODE2D_FORMAT.VERSION.CMD);
      this.buffer.writeUInt8(version);
  
      // Set level
      if (!level || (level && typeof level !== 'string'))
        level = _.CODE2D_FORMAT.QR_LEVEL_L;
      this.buffer.write(_.MODEL.QSPRINTER.CODE2D_FORMAT.LEVEL.CMD);
      this.buffer.write(_.MODEL.QSPRINTER.CODE2D_FORMAT.LEVEL.OPTIONS[level.toUpperCase()]);
  
      // Transfer data(code) to buffer
      this.buffer.write(_.MODEL.QSPRINTER.CODE2D_FORMAT.SAVEBUF.CMD_P1);
      this.buffer.writeUInt16LE(dataRaw.length + _.MODEL.QSPRINTER.CODE2D_FORMAT.LEN_OFFSET);
      this.buffer.write(_.MODEL.QSPRINTER.CODE2D_FORMAT.SAVEBUF.CMD_P2);
      this.buffer.write(dataRaw);
  
      // Print from buffer
      this.buffer.write(_.MODEL.QSPRINTER.CODE2D_FORMAT.PRINTBUF.CMD_P1);
      this.buffer.writeUInt16LE(dataRaw.length + _.MODEL.QSPRINTER.CODE2D_FORMAT.LEN_OFFSET);
      this.buffer.write(_.MODEL.QSPRINTER.CODE2D_FORMAT.PRINTBUF.CMD_P2);
    }
    return this;
};

module.exports = Printer;