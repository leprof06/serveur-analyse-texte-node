// semantic.js — appel à un micro-service embeddings (optionnel mais recommandé)
import axios from "axios";

/**
 * POST vers ton service embeddings { sentences: [ ... ] } -> { vectors: number[][] }
 * Retourne un score de similarité cosinus 0..100 entre userText et expectedAnswer.
 */
export async function semanticSimilarity(userText, expectedAnswer) {
  if (!expectedAnswer || !userText) return 0;
  const EMB_URL = process.env.EMB_BASE_URL; // ex: http://emb:8000
  if (!EMB_URL) return 0; // neutre si non configuré

  const { data } = await axios.post(`${EMB_URL}/embed`, { sentences: [userText, expectedAnswer] }, { timeout: 8000 });
  const [u, e] = data.vectors || [];
  if (!u || !e) return 0;

  // cosinus
  const dot = u.reduce((s, x, i) => s + x * e[i], 0);
  const nu = Math.sqrt(u.reduce((s, x) => s + x * x, 0));
  const ne = Math.sqrt(e.reduce((s, x) => s + x * x, 0));
  const cos = nu && ne ? dot / (nu * ne) : 0;
  return Math.round(Math.max(0, Math.min(1, cos)) * 100);
}
