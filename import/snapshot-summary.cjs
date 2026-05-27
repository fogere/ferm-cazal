#!/usr/bin/env node
/**
 * Lit le dernier backup Firestore et produit un résumé compact pour le
 * matching avec les docs papier (animaux par nom, land_plots, fences).
 *
 *   node import/snapshot-summary.cjs > import/snapshot-summary.json
 *
 * Pas d'accès réseau — pure lecture du JSON local.
 */
const fs   = require('fs');
const path = require('path');

const BACKUPS_DIR = path.join(__dirname, '..', 'backups');

const files = fs.readdirSync(BACKUPS_DIR)
  .filter(f => f.startsWith('firestore-backup-') && f.endsWith('.json'))
  .sort()
  .reverse();
if (!files.length) {
  console.error('Aucun backup trouvé dans backups/');
  process.exit(1);
}
const latest = files[0];
const data = JSON.parse(fs.readFileSync(path.join(BACKUPS_DIR, latest), 'utf8'));

const out = {
  source:     latest,
  exportedAt: data.exportedAt,
  animals: [],
  land_plots: [],
  fences: [],
  water_streams: [],
  water_manual: [],
  water_natural: [],
  batteries: [],
};

// Animaux : on garde id, name, species, gender, sireNumber, transponderId, enclosureId
const animals = data.collections.animals || [];
for (const a of animals) {
  out.animals.push({
    id:            a.id,
    name:          a.name,
    species:       a.species,
    gender:        a.gender,
    sireNumber:    a.sireNumber,
    transponderId: a.transponderId,
    enclosureId:   a.enclosureId,
  });
}

// Map pins : split par type
const pins = data.collections.map_pins || [];
for (const p of pins) {
  const base = {
    id:           p.id,
    name:         p.name,
    type:         p.type,
    lat:          p.lat,
    lng:          p.lng,
    cadastralRef: p.cadastralRef,
    pacIlot:      p.pacIlot,
    note:         p.note ? (p.note.slice(0, 200) + (p.note.length > 200 ? '…' : '')) : undefined,
  };
  if (p.type === 'land_plot') {
    out.land_plots.push({
      ...base,
      currentOccupants: p.currentOccupants,
      occupiedSince:    p.occupiedSince,
      surfaceM2:        p.surfaceM2,
      landowner:        p.landowner,
      parcelsCount:     Array.isArray(p.parcels) ? p.parcels.length : 0,
    });
  } else if (p.type === 'fence') {
    out.fences.push({ ...base, closed: p.closed, pointsCount: (p.points||[]).length });
  } else if (p.type === 'water_stream') {
    out.water_streams.push({
      ...base,
      streamMode: p.streamMode,
      streamActiveMonths: p.streamActiveMonths,
      observationsCount: Array.isArray(p.streamObservations) ? p.streamObservations.length : 0,
    });
  } else if (p.type === 'water_manual') {
    out.water_manual.push(base);
  } else if (p.type === 'water_natural') {
    out.water_natural.push(base);
  } else if (p.type === 'battery') {
    out.batteries.push(base);
  }
}

// Tri par nom pour lecture humaine
out.animals.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
out.land_plots.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
out.fences.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
