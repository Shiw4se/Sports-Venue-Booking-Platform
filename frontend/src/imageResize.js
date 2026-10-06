// Shrinks a picked image in the browser before upload, so only tens/hundreds of KB leave
// the device instead of a multi-megabyte photo.

export const AVATAR_SIZE = 256;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('This file could not be read as an image'));
        };
        img.src = url;
    });
}

function toDataUrl(canvas, quality) {
    // WebP where supported, JPEG otherwise (older Safari ignores the WebP request)
    const webp = canvas.toDataURL('image/webp', quality);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality);
}

// square: center-crop to size×size (avatars); otherwise keep the aspect ratio, longest side ≤ maxSide
export async function resizeImage(file, { maxSide = 1600, square = false, quality = 0.82 } = {}) {
    if (!file.type.startsWith('image/')) throw new Error('Please choose an image file');
    if (file.size > MAX_INPUT_BYTES) throw new Error('The image is larger than 15 MB');

    const img = await loadImage(file);
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    let sx = 0;
    let sy = 0;
    let sw = w;
    let sh = h;
    let outW;
    let outH;
    if (square) {
        const side = Math.min(w, h);
        sx = (w - side) / 2;
        sy = (h - side) / 2;
        sw = sh = side;
        outW = outH = Math.min(maxSide, side);
    } else {
        const scale = Math.min(1, maxSide / Math.max(w, h));
        outW = Math.round(w * scale);
        outH = Math.round(h * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    return toDataUrl(canvas, quality);
}

export const resizeToAvatar = (file) => resizeImage(file, { maxSide: AVATAR_SIZE, square: true, quality: 0.85 });

// Venue gallery: 1600px on the longest side, stepping the quality down until it fits the 900 KB limit
export async function resizeVenuePhoto(file) {
    for (const quality of [0.82, 0.7, 0.55]) {
        const dataUrl = await resizeImage(file, { maxSide: 1600, quality });
        if (dataUrl.length * 0.75 < 880 * 1024) return dataUrl;
    }
    return resizeImage(file, { maxSide: 1200, quality: 0.6 });
}
