// src/semantic.js
// Appelle le micro-service embeddings pour obtenir une similarité de sens (0..100).
import axios from "axios";

/**
 * Retourne un entier 0..100 (cosinus * 100), ou null si EMB_BASE_URL non configuré.
 * @param {string} a - texte élève
 * @param {string} b - réponse attendue
 */
export async function semanticSimilarity100(a, b) {
  const base = (process.env.EMB_BASE_URL || "").trim();
  if (!base || !a || !b) return null;

  try {
    const url = `${base.replace(/\/+$/,"")}/similarity`;
    const { data } = await axios.post(
      url,
      { a, b },
      { headers: { "Content-Type": "application/json" }, timeout: 10000 }
    );
    // data.similarity est ~ [0..1] ; on renvoie 0..100 arrondi
    const sim = Number(data?.similarity ?? 0);
    if (!Number.isFinite(sim)) return null;
    return Math.max(0, Math.min(100, Math.round(sim * 100)));
  } catch (e) {
    // Tolérant aux pannes : on loggue et on remonte null (le reste de l'analyse continue)
    console.error("[semantic] error:", e?.message || e);
    return null;
  }
}
