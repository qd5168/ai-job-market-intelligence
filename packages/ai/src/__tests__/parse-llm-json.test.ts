import { describe, it, expect } from 'vitest';
import { parseLLMJson } from '../parse-llm-json';

describe('parseLLMJson', () => {
  it('parses plain JSON with no fence', () => {
    expect(parseLLMJson('{"foo": 1}')).toEqual({ foo: 1 });
  });

  it('strips a ```json fenced response', () => {
    const content = '```json\n{"foo": 1}\n```';
    expect(parseLLMJson(content)).toEqual({ foo: 1 });
  });

  it('strips a bare ``` fence with no language tag', () => {
    const content = '```\n{"foo": 1}\n```';
    expect(parseLLMJson(content)).toEqual({ foo: 1 });
  });

  it('tolerates surrounding whitespace', () => {
    const content = '  \n```json\n{"foo": 1}\n```\n  ';
    expect(parseLLMJson(content)).toEqual({ foo: 1 });
  });

  it('throws on genuinely invalid JSON', () => {
    expect(() => parseLLMJson('not json')).toThrow();
  });

  // Observed in production: a chatty paid fallback model (qwen/qwen3.7-flash)
  // ignored response_format:json_object and replied with prose instead.
  it('extracts a JSON object embedded in conversational prose', () => {
    const content = 'Here\'s the analysis:\n{"foo": 1}\nLet me know if you need anything else!';
    expect(parseLLMJson(content)).toEqual({ foo: 1 });
  });

  it('extracts a JSON object embedded prose even without a trailing sentence', () => {
    const content = 'Sure, here you go: {"foo": 1}';
    expect(parseLLMJson(content)).toEqual({ foo: 1 });
  });

  it('still throws when no JSON object is present anywhere in the prose', () => {
    expect(() => parseLLMJson("Here's a template you can use for outreach messages.")).toThrow();
  });
});
