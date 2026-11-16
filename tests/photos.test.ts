import { it, expect } from 'vitest';
import sharp from 'sharp';
import { prepareUploadedPhoto } from '../functions/src/photos';
it('reduce las fotos y elimina EXIF antes de guardarlas', async () => {
  const original = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#789c79' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const result = await prepareUploadedPhoto(
    `data:image/jpeg;base64,${original.toString('base64')}`,
  );
  const metadata = await sharp(Buffer.from(result!.split(',')[1], 'base64')).metadata();
  expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(512);
  expect(metadata.exif).toBeUndefined();
  expect(metadata.orientation).toBeUndefined();
  expect(result!.length).toBeLessThanOrEqual(180000);
});
it('rechaza contenido inválido, SVG y archivos demasiado grandes', async () => {
  await expect(prepareUploadedPhoto('data:image/jpeg;base64,aGVsbG8=')).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await expect(prepareUploadedPhoto('data:image/svg+xml;base64,PHN2Zy8+')).rejects.toMatchObject({
    code: 'invalid-argument',
  });
  await expect(
    prepareUploadedPhoto('data:image/jpeg;base64,' + 'a'.repeat(180000)),
  ).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(await prepareUploadedPhoto()).toBeUndefined();
});
