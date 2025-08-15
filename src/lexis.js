export function lexisMetrics(text, lang="fr") {
  const tokens = (text || "").toLowerCase().match(/\p{L}+/gu) || [];
  const total = tokens.length;
  const types = new Set(tokens).size;
  const ttr = total ? types / total : 0; // type-token ratio

  // répétitions grossières
  const freq = {};
  tokens.forEach(w => freq[w] = (freq[w] || 0) + 1);
  const repeatedTop = Object.entries(freq).filter(([,n]) => n >= 4).map(([w]) => w).slice(0,5);

  // heuristique score 0..100 (TTR 0.5 ~ 100 ; <0.2 ~ 40)
  const ttrScore = Math.round(Math.min(1, (ttr / 0.5)) * 100);
  const repetPenalty = Math.min(40, repeatedTop.length * 10);
  const lexisScore = Math.max(0, ttrScore - repetPenalty);

  return { total, types, ttr: Number(ttr.toFixed(3)), ttrScore, repeatedTop, lexisScore };
}
