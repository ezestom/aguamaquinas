import legacyEquipment from './legacy-equipment.json' with { type: 'json' };

export const referenceEquipment = legacyEquipment.map(item => ({
  ...item,
  photos: JSON.stringify(item.photos),
  reference: true,
}));
