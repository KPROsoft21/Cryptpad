// cipher.ts — shared encryption logic (used by main process)

export const MAGIC = 'CRYPTPAD::V1::';
export const EXT   = '.crypt';

export const ENCRYPT_MAP: Readonly<Record<string, string>> = {
  // lowercase → mathematical / logic symbols
  a:'∀', b:'∂', c:'∃', d:'∆', e:'∈', f:'∉', g:'∑', h:'∏',
  i:'∪', j:'∩', k:'∫', l:'≈', m:'≠', n:'≡', o:'≤', p:'≥',
  q:'⊂', r:'⊃', s:'⊄', t:'⊆', u:'⊇', v:'⊕', w:'⊗', x:'⊥',
  y:'∇', z:'√',
  // uppercase → arrow / double-arrow symbols
  A:'↑', B:'↓', C:'←', D:'→', E:'↔', F:'⇒', G:'⇔', H:'⇐',
  I:'⇑', J:'⇓', K:'⇕', L:'⇖', M:'⇗', N:'⇘', O:'⇙', P:'⇚',
  Q:'⇛', R:'⇜', S:'⇝', T:'⇞', U:'⇟', V:'⇠', W:'⇡', X:'⇢',
  Y:'⇣', Z:'⇤',
};

export const DECRYPT_MAP: Readonly<Record<string, string>> =
  Object.fromEntries(Object.entries(ENCRYPT_MAP).map(([k, v]) => [v, k]));

export function encrypt(text: string): string {
  return [...text].map(c => ENCRYPT_MAP[c] ?? c).join('');
}

export function decrypt(text: string): string {
  return [...text].map(c => DECRYPT_MAP[c] ?? c).join('');
}
