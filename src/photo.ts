// Local conversion: only a small JPEG is submitted; original files never leave the browser.
export async function preparePhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Elegí una foto JPG, PNG o WebP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('La foto debe pesar menos de 10 MB.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('No pudimos leer esa foto. Probá con otra imagen.');
  }
  try {
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar la foto.');
    context.fillStyle = '#f5f6ef';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.65, 0.45]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= 180000) return data;
    }
    throw new Error('La imagen sigue siendo demasiado grande. Elegí una foto más pequeña.');
  } finally {
    bitmap.close();
  }
}
