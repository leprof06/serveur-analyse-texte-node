export function organizationMetrics(text, lang="fr") {
  const t = (text || "").trim();
  const paragraphs = t.split(/\n{2,}/).filter(Boolean).length || 1;
  const words = t.split(/\s+/).filter(Boolean).length;

  // Connecteurs courants (ex FR + EN ; tu peux étendre DE/ES/RU/KO/JA/ZH)
  const connectors = {
    fr: ["d'abord","ensuite","puis","enfin","cependant","toutefois","par conséquent","de plus","en revanche"],
    en: ["first","then","next","finally","however","nevertheless","therefore","moreover","on the other hand"]
  }[lang] || [];
  const lower = t.toLowerCase();
  const foundConn = connectors.filter(c => lower.includes(c)).length;

  // scores simples 0..100
  const paraScore = Math.min(100, Math.round((paragraphs / 3) * 100));  // 3+ paragraphes = 100
  const connScore  = Math.min(100, foundConn * 25);                      // 4+ connecteurs = 100

  return { paragraphs, words, paraScore, connScore };
}
