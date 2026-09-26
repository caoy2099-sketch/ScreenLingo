'use strict';

const { imageSize } = require('image-size');

const MAX_DECODED_IMAGE_PIXELS = 32_000_000;
const MAX_IMAGE_DIMENSION = 32_768;

class ImageDimensionError extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ImageDimensionError';
    this.code = 'IMAGE_DIMENSIONS_INVALID';
  }
}

function inspectImageBuffer(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new ImageDimensionError('图片内容为空或无法读取。');
  }

  const maxPixels = options.maxPixels ?? MAX_DECODED_IMAGE_PIXELS;
  const maxDimension = options.maxDimension ?? MAX_IMAGE_DIMENSION;
  const sizeOf = options.sizeOf || imageSize;
  let dimensions;
  try {
    dimensions = sizeOf(bytes);
  } catch (error) {
    throw new ImageDimensionError('无法读取图片尺寸，请换用有效的 PNG、JPEG、WebP 或 BMP 图片。', error);
  }

  const width = Number(dimensions?.width);
  const height = Number(dimensions?.height);
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    throw new ImageDimensionError('图片尺寸无效。');
  }
  if (width > maxDimension || height > maxDimension || width * height > maxPixels) {
    throw new ImageDimensionError(
      `图片解码尺寸过大（${width} × ${height}），请先裁剪到 3200 万像素以内。`
    );
  }

  return { width, height, type: dimensions.type };
}

function inspectImageDataUrl(dataUrl, options = {}) {
  if (typeof dataUrl !== 'string') {
    throw new ImageDimensionError('图片内容无效。');
  }
  const separatorIndex = dataUrl.indexOf(',');
  if (separatorIndex < 0) {
    throw new ImageDimensionError('图片内容无效。');
  }
  return inspectImageBuffer(Buffer.from(dataUrl.slice(separatorIndex + 1), 'base64'), options);
}

module.exports = {
  ImageDimensionError,
  MAX_DECODED_IMAGE_PIXELS,
  MAX_IMAGE_DIMENSION,
  inspectImageBuffer,
  inspectImageDataUrl
};
