const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBED_MODEL = "nomic-embed-text";

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });

  if (!res.ok) {
    throw new Error(`Embedding error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.embedding as number[];
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  // Ollama doesn't support batch embeddings natively, run sequentially
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}
