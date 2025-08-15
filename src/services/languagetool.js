import axios from "axios";

/**
 * Appelle LanguageTool.
 * - Si LT_BASE_URL est défini: on l’utilise (self-host).
 * - Sinon, on tente l’API publique (https://api.languagetool.org/v2/check).
 * @param {string} text
 * @param {string} lang  ex: "fr", "en"
 * @param {string|null} apiKey
 */
export async function checkWithLanguageTool(text, lang, apiKey = null) {
  const base = process.env.LT_BASE_URL?.trim() || "https://api.languagetool.org";
  const url = `${base.replace(/\/+$/,"")}/v2/check`;

  const params = new URLSearchParams();
  params.append("language", lang || "auto");
  params.append("text", text);
  // Quelques règles utiles : tu pourras les ajuster côté self-host si besoin
  params.append("enabledOnly", "false");

  if (apiKey) params.append("apiKey", apiKey);

  const { data } = await axios.post(url, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000
  });

  // data.matches: [{ message, replacements, rule: { id, description, issueType }, offset, length, shortMessage }]
  return data;
}
