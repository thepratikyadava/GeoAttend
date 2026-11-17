/**
 * Extracts a compact, lighting-tolerant 72-float color + spatial signature
 * from an image or video frame using an HTML5 Canvas.
 *
 * When a `faceBox` ({ x, y, width, height } in source coordinates) is provided,
 * pixels inside the face bounding box are excluded so only the classroom
 * background is measured.
 */
export function extractBackgroundSignatureFromSource(source, faceBox = null) {
  const width = 64;
  const height = 48;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);

  const imgData = ctx.getImageData(0, 0, width, height).data;

  const srcWidth = source.videoWidth || source.naturalWidth || source.width || width;
  const srcHeight = source.videoHeight || source.naturalHeight || source.height || height;

  let maskX0 = -1;
  let maskY0 = -1;
  let maskX1 = -1;
  let maskY1 = -1;

  if (faceBox && srcWidth > 0 && srcHeight > 0) {
    // Expand face box slightly to exclude head/shoulders from background check
    const padX = faceBox.width * 0.25;
    const padY = faceBox.height * 0.25;
    maskX0 = Math.max(0, Math.floor(((faceBox.x - padX) / srcWidth) * width));
    maskY0 = Math.max(0, Math.floor(((faceBox.y - padY) / srcHeight) * height));
    maskX1 = Math.min(width, Math.ceil(((faceBox.x + faceBox.width + padX) / srcWidth) * width));
    maskY1 = Math.min(height, Math.ceil(((faceBox.y + faceBox.height + padY * 1.6) / srcHeight) * height));
  }

  // 24 RGB histogram bins (8 per channel) + 4x4 grid of RGB means (48 floats) = 72 floats
  const histR = new Array(8).fill(0);
  const histG = new Array(8).fill(0);
  const histB = new Array(8).fill(0);
  const gridR = new Array(16).fill(0);
  const gridG = new Array(16).fill(0);
  const gridB = new Array(16).fill(0);
  const gridCount = new Array(16).fill(0);

  let totalPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        maskX0 >= 0 &&
        x >= maskX0 &&
        x <= maskX1 &&
        y >= maskY0 &&
        y <= maskY1
      ) {
        continue;
      }

      const idx = (y * width + x) * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];

      histR[Math.min(7, r >> 5)] += 1;
      histG[Math.min(7, g >> 5)] += 1;
      histB[Math.min(7, b >> 5)] += 1;

      const gx = Math.min(3, Math.floor((x / width) * 4));
      const gy = Math.min(3, Math.floor((y / height) * 4));
      const gIdx = gy * 4 + gx;

      gridR[gIdx] += r / 255;
      gridG[gIdx] += g / 255;
      gridB[gIdx] += b / 255;
      gridCount[gIdx] += 1;
      totalPixels += 1;
    }
  }

  const denom = Math.max(1, totalPixels);
  const vector = [
    ...histR.map((v) => v / denom),
    ...histG.map((v) => v / denom),
    ...histB.map((v) => v / denom),
    ...gridR.map((v, i) => (gridCount[i] ? v / gridCount[i] : 0)),
    ...gridG.map((v, i) => (gridCount[i] ? v / gridCount[i] : 0)),
    ...gridB.map((v, i) => (gridCount[i] ? v / gridCount[i] : 0))
  ];

  // L2 normalize
  const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vector.map((v) => Number((v / norm).toFixed(5)));
}


export function extractBackgroundSignatureFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const sig = extractBackgroundSignatureFromSource(img, null);
        URL.revokeObjectURL(url);
        resolve(sig);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Unable to read image file: ${file.name}`));
    };
    img.src = url;
  });
}
