/**
 * Compresse une image (File) en data URL JPEG.
 * Redimensionne pour que le côté le plus long ne dépasse pas maxSize px,
 * puis encode en JPEG à `quality` (0..1).
 *
 * Tailles typiques en sortie (photo téléphone 12MP) :
 *  - maxSize=1280, q=0.75 → 100-300 KB
 *  - maxSize=1600, q=0.8  → 200-500 KB
 *
 * Limite Firestore : 1 MiB par document (data URL base64 inflate de ~33%).
 */
export async function compressImage(
  file: File,
  maxSize = 1280,
  quality = 0.75,
): Promise<string> {
  // 1) Lire le fichier en data URL
  const sourceUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'))
    reader.readAsDataURL(file)
  })

  // 2) Charger dans un <img>
  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image()
    i.onload  = () => resolve(i)
    i.onerror = () => reject(new Error('Image illisible'))
    i.src = sourceUrl
  })

  // 3) Calculer la nouvelle taille
  const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1)
  const w = Math.round(img.width  * ratio)
  const h = Math.round(img.height * ratio)

  // 4) Dessiner dans un canvas et exporter en JPEG
  const canvas = document.createElement('canvas')
  canvas.width  = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')
  ctx.drawImage(img, 0, 0, w, h)

  return canvas.toDataURL('image/jpeg', quality)
}
