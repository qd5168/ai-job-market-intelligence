// Despite requesting `response_format: { type: 'json_object' }`, some
// OpenRouter models don't honor it: some (e.g. openai/gpt-oss-20b:free) wrap
// the response in a markdown code fence (```json ... ```), others (observed
// with qwen/qwen3.7-flash as a paid CHAT_MODEL_FALLBACK) ignore it entirely
// and reply with conversational prose that happens to contain a JSON object
// somewhere inside it. Try, in order: fenced content, the trimmed string as-is,
// then the first {...} object found anywhere in the string.
export function parseLLMJson(content: string): unknown {
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) return JSON.parse(fenceMatch[1]!);

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!objectMatch) throw error;
    return JSON.parse(objectMatch[0]);
  }
}
