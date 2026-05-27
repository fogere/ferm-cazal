#!/usr/bin/env node
/**
 * Convertit un .docx / .odt / .odp en texte brut lisible.
 *
 *   node import/extract-text.cjs "fichier/Fond rouge bas 988.odt" > import/text/fond-rouge.txt
 *
 * Tactique :
 *   - .docx → word/document.xml
 *   - .odt / .odp → content.xml
 *   - On extrait avec `unzip -p`, on strip les balises, on normalise les blancs.
 *   - Les sauts de paragraphe (<w:p>, <text:p>) deviennent des \n. Les sauts forts
 *     (<text:h>, <w:br>) deviennent \n\n pour qu'on garde la structure des titres.
 *
 * Pas d'extraction d'image ici — on ne lit que le texte. Les images sont listées
 * en pied (au cas où elles contiendraient un schéma à dessiner manuellement).
 */
const { execSync } = require('child_process');
const path = require('path');

function fail(msg) { console.error(msg); process.exit(1); }

const src = process.argv[2];
if (!src) fail('usage: node extract-text.cjs <fichier>');

const ext = path.extname(src).toLowerCase();
const contentPath =
  ext === '.docx' ? 'word/document.xml' :
  (ext === '.odt' || ext === '.odp') ? 'content.xml' :
  null;
if (!contentPath) fail(`extension non gérée: ${ext}`);

let xml;
try {
  xml = execSync(`unzip -p "${src}" ${contentPath}`, { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
} catch (e) {
  fail(`unzip a échoué: ${e.message}`);
}

// Liste des images en pied de page
let images = [];
try {
  const list = execSync(`unzip -l "${src}"`, { maxBuffer: 4 * 1024 * 1024 }).toString('utf8');
  images = list.split('\n')
    .map(l => l.trim())
    .filter(l => /\.(png|jpe?g|gif|bmp|svg|tiff?)$/i.test(l))
    .map(l => l.split(/\s+/).pop());
} catch (_) { /* ignore */ }

// Normalisation : marqueurs de paragraphe et titres → \n
// .docx (OOXML)
let txt = xml
  // titre : balises de heading style → on les marque \n\n
  .replace(/<w:br[^>]*\/>/g, '\n')
  .replace(/<w:tab[^>]*\/>/g, '\t')
  .replace(/<\/w:p>/g, '\n')
  .replace(/<w:p[^>]*>/g, '')
  // .odt/.odp (ODF)
  .replace(/<text:line-break[^>]*\/>/g, '\n')
  .replace(/<text:tab[^>]*\/>/g, '\t')
  .replace(/<\/text:h>/g, '\n\n')
  .replace(/<text:h[^>]*>/g, '\n')
  .replace(/<\/text:p>/g, '\n')
  .replace(/<text:p[^>]*>/g, '')
  .replace(/<draw:page[^>]*draw:name="([^"]*)"[^>]*>/g, '\n\n=== PAGE: $1 ===\n')
  // strip all remaining tags
  .replace(/<[^>]+>/g, '')
  // décoder les entités xml courantes
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
  // espaces multiples + lignes vides multiples
  .replace(/[ \t]+/g, ' ')
  .replace(/\n[ \t]+/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

process.stdout.write(txt + '\n');
if (images.length) {
  process.stdout.write('\n\n--- IMAGES PRÉSENTES DANS LE DOC ---\n');
  for (const i of images) process.stdout.write(i + '\n');
}
