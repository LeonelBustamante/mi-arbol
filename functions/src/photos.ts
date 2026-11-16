import sharp from 'sharp';
import { z } from 'zod';
import { HttpsError } from 'firebase-functions/v2/https';
export const photoSchema = z
  .string()
  .max(180000)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/);
export async function prepareUploadedPhoto(input?: string): Promise<string | undefined> {
  if (!input) return undefined;
  try {
    photoSchema.parse(input);
    const image = await sharp(Buffer.from(input.split(',')[1], 'base64'), {
      limitInputPixels: 16000000,
    })
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    const result = `data:image/jpeg;base64,${image.toString('base64')}`;
    if (result.length > 180000) throw new Error('Too large');
    return result;
  } catch {
    throw new HttpsError(
      'invalid-argument',
      'La foto no es válida. Elegí una imagen JPG, PNG o WebP desde el formulario.',
    );
  }
}
