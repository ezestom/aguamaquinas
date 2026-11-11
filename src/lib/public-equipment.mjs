import { db } from './db.mjs';
import { referenceEquipment } from './reference-equipment.mjs';

export function findPublicEquipment(ref, connection = db()) {
  return connection.prepare(`SELECT m.*, d.price_max FROM machines m LEFT JOIN listing_details d ON d.machine_ref = m.ref
    WHERE m.ref = ? AND m.status = 'published' AND m.sample = 0`).get(ref)
    ?? referenceEquipment.find(item => item.ref === ref);
}
