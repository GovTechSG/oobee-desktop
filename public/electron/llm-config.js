// Resolve which LLM to talk to. Priority order:
//   1. OPENAI_API_KEY / OPENAI_API_BASE (any OpenAI-compatible endpoint, e.g. Open WebUI)
//   2. ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL
//   3. ~/.claude/settings.json (ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL — same file Claude Code uses)
//
// Modeled on dsib/src/server.ts loadClaudeConfig(), adapted for an OpenAI-style chat API surface.
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadLLMConfig() {
  // (1) OpenAI-compatible (local Open WebUI, LM Studio, etc.)
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_BASE) {
    return {
      provider: 'openai-compatible',
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_API_BASE.replace(/\/+$/, ''),
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      headers: {},
    };
  }

  // (2) Explicit Anthropic env
  if (process.env.ANTHROPIC_API_KEY) {
    const baseURL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
    return {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: `${baseURL}/v1`,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      headers: {},
    };
  }

  // (3) Fall back to the local Claude Code settings — same file the CLI reads.
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const env = settings.env || {};
    const apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
    const baseURL = env.ANTHROPIC_BASE_URL;
    if (apiKey && baseURL) {
      return {
        provider: 'anthropic',
        apiKey,
        baseURL: `${baseURL.replace(/\/+$/, '')}/v1`,
        model: env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'bedrock.claude-sonnet-4-6',
        headers: {},
        source: settingsPath,
      };
    }
  }

  throw new Error(
    'No LLM configured. Set OPENAI_API_KEY+OPENAI_API_BASE in .env, or ANTHROPIC_API_KEY, ' +
    'or configure ~/.claude/settings.json with ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL.'
  );
}

// Provider-agnostic chat call. Returns { text, raw }.
async function callLLM(cfg, { system, user, maxTokens = 4000, temperature = 0.3, responseFormat }) {
  const axios = require('axios');

  if (cfg.provider === 'anthropic') {
    // Anthropic /v1/messages
    const body = {
      model: cfg.model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    };
    const resp = await axios.post(`${cfg.baseURL}/messages`, body, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'authorization': `Bearer ${cfg.apiKey}`,
        'anthropic-version': '2023-06-01',
        ...cfg.headers,
      },
      timeout: 120000,
    });
    const text = resp.data?.content?.map(b => b.text || '').join('\n') || '';
    return { text, raw: resp.data };
  }

  // OpenAI-compatible /chat/completions
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    temperature,
  };
  if (responseFormat) body.response_format = responseFormat;

  const resp = await axios.post(`${cfg.baseURL}/chat/completions`, body, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
      ...cfg.headers,
    },
    timeout: 120000,
  });
  const text = resp.data?.choices?.[0]?.message?.content || '';
  return { text, raw: resp.data };
}

module.exports = { loadLLMConfig, callLLM };
