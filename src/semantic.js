// Similarité de sens via Hugging Face Inference API (feature-extraction -> embeddings -> cosinus).
// Retourne un entier 0..100 (ou null si la clé/connexion manque).
import axios from "axios";

/**
 * @param {string} a - texte élève
 * @param {string} b - réponse attendue
 * @returns {Promise<number|null>} 0..100 ou null si indisponible
 */
export async function semanticSimilarity100(a, b) {
  const token = (process.env.HF_API_KEY || "").trim();
  const model = (process.env.HF_MODEL || "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2").trim();
  if (!token || !a || !b) return null;

  const url = `https://api-inference.huggingface.co/pipeline/feature-extraction/${model}`;

  try {
    // 1) Embeddings pour [a, b]
    const { data } = await axios.post(
      url,
      [a, b],
      {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        timeout: 15000
      }
    );

    // Certains modèles renvoient [seq_len x hid_dim] → moyenne (pooling)
    const v1 = Array.isArray(data?.[0]?.[0]) ? avgPool(data[0]) : data[0];
    const v2 = Array.isArray(data?.[1]?.[0]) ? avgPool(data[1]) : data[1];
    if (!Array.isArray(v1) || !Array.isArray(v2)) return null;

    // 2) Similarité cosinus -> [0..100]
    const sim = cosine(v1, v2); // -1..1
    return Math.max(0, Math.min(100, Math.round(((sim + 1) / 2) * 100)));
  } catch (e) {
    console.error("[semantic] HF API error:", e?.response?.status, e?.message);
    return null;
  }
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function avgPool(mat) {
  const rows = mat.length, cols = rows ? mat[0].length : 0;
  const out = new Array(cols).fill(0);
  for (let r = 0; r < rows; r++) {
    const row = mat[r];
    for (let c = 0; c < cols; c++) out[c] += row[c];
  }
  for (let c = 0; c < cols; c++) out[c] /= rows || 1;
  return out;
}
