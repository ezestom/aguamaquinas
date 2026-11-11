import { seed } from './seed.mjs';

export const referenceEquipment = seed.map(row => {
  const [id, title, category, brand, model, province, format, format_detail, capacity, condition, , , photo, description] = row;
  return {
    ref: `EJ-${id}`, title, category, brand, model, province, format, format_detail, capacity, condition,
    photos: JSON.stringify([`/equipos/${photo}.webp`]), description, reference: true,
  };
});
