// Fantasy name generation for folk, settlements, and monsters.

const FIRST_A = ['Bre', 'Ael', 'Tor', 'Mar', 'Ish', 'Gwen', 'Hal', 'Ryn', 'Sef', 'Or',
  'Lun', 'Dor', 'Ka', 'Vel', 'Bram', 'El', 'Fen', 'Isol', 'Yor', 'Tam',
  'Ash', 'Ber', 'Cal', 'Del', 'Eth', 'Fay', 'Gor', 'Hild', 'Ing', 'Jor'];
const FIRST_B = ['wyn', 'ric', 'a', 'eth', 'da', 'mir', 'na', 'dan', 'la', 'ric',
  'wen', 'th', 'is', 'or', 'ia', 'mund', 'lyn', 'gar', 'essa', 'o',
  'ild', 'ard', 'ny', 'ra', 'vin', 'as', 'el', 'ita', 'bert', 'una'];

const SETTLE_A = ['Oak', 'Stone', 'Ash', 'Raven', 'Mill', 'Thorn', 'Elm', 'Wolf', 'Fern', 'Salt',
  'Bright', 'Grey', 'High', 'Low', 'Deep', 'Cold', 'Ember', 'Briar', 'Hollow', 'Amber'];
const SETTLE_B = ['stead', 'holm', 'brook', 'field', 'haven', 'watch', 'ford', 'dale', 'moor', 'fall',
  'crest', 'hearth', 'gate', 'run', 'shade', 'rest', 'barrow', 'mere', 'wick', 'reach'];

const BEAST_NAMES = ['Grukk', 'Old Maw', 'Sharptooth', 'The Grey Sorrow', 'Bonecrack', 'Hollowfang',
  'Murgha', 'The Pale Hunger', 'Duskclaw', 'Rotmaw', 'Vharzul', 'Ashwing', 'The Red Ruin',
  'Skorn', 'Nightgnaw', 'The Withering', 'Korgoth', 'Emberjaw'];

export function personName(rng) {
  return rng.pick(FIRST_A) + rng.pick(FIRST_B);
}

export function settlementName(rng) {
  return rng.pick(SETTLE_A) + rng.pick(SETTLE_B);
}

export function beastName(rng) {
  return rng.pick(BEAST_NAMES);
}
