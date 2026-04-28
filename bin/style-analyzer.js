#!/usr/bin/env node

import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import jsonPatch from 'fast-json-patch';

const { applyPatch } = jsonPatch;

const DEFAULT_CONFIG_FILE = '.maplibre-gl-a11y.config.json';
const DEFAULT_OUTPUT_PREFIX = 'a11y_';
const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: 'claude-3-5-haiku-latest',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-pro'
};

function parseArgs(argv) {
  const args = {
    stylePath: '',
    configPath: '',
    nonInteractive: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--config' || arg === '-c') {
      args.configPath = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--non-interactive') {
      args.nonInteractive = true;
      continue;
    }
    if (!args.stylePath) {
      args.stylePath = arg;
      continue;
    }
  }

  return args;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function ensureProviderConfig(config) {
  const provider = config.provider;
  if (!provider || !['anthropic', 'openai', 'gemini'].includes(provider)) {
    throw new Error('Config must include provider: "anthropic", "openai", or "gemini".');
  }

  const providerConfig = config[provider];
  if (!providerConfig || typeof providerConfig !== 'object') {
    throw new Error(`Config must include a "${provider}" object with credentials.`);
  }

  if (!providerConfig.apiKey || typeof providerConfig.apiKey !== 'string') {
    throw new Error(`Config for "${provider}" must include "apiKey".`);
  }

  return {
    provider,
    apiKey: providerConfig.apiKey,
    apiUrl: providerConfig.apiUrl,
    model: providerConfig.model || DEFAULT_MODEL_BY_PROVIDER[provider]
  };
}

function getCompactStyleForA11y(style) {
  const layers = Array.isArray(style.layers) ? style.layers : [];
  const whitelistedProperties = new Set([
    'visibility',
    'text-field',
    'text-font',
    'text-size',
    'text-max-width',
    'text-letter-spacing',
    'text-line-height',
    'text-allow-overlap',
    'text-ignore-placement',
    'text-padding',
    'symbol-spacing',
    'icon-image',
    'icon-size',
    'icon-allow-overlap',
    'line-color',
    'line-width',
    'line-opacity',
    'line-blur',
    'fill-color',
    'fill-opacity',
    'fill-outline-color',
    'circle-color',
    'circle-radius',
    'circle-stroke-color',
    'circle-stroke-width',
    'circle-opacity',
    'text-color',
    'text-halo-color',
    'text-halo-width',
    'text-halo-blur',
    'icon-color',
    'icon-opacity',
    'icon-halo-color',
    'icon-halo-width'
  ]);

  function compactValue(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}...` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= 2) return '[truncated]';
    if (Array.isArray(value)) return value.slice(0, 8).map((entry) => compactValue(entry, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      const entries = Object.entries(value).slice(0, 10);
      for (const [key, entryValue] of entries) {
        out[key] = compactValue(entryValue, depth + 1);
      }
      return out;
    }
    return String(value);
  }

  function pickWhitelisted(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
      if (whitelistedProperties.has(key)) {
        out[key] = compactValue(value);
      }
    }
    return out;
  }

  const compactLayers = layers
    .filter((layer) => ['symbol', 'line', 'fill', 'circle'].includes(layer.type))
    .slice(0, 160)
    .map((layer) => ({
      id: layer.id,
      type: layer.type,
      source: layer.source,
      sourceLayer: layer['source-layer'],
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
      layout: pickWhitelisted(layer.layout),
      paint: pickWhitelisted(layer.paint)
    }));

  return {
    id: style.id,
    name: style.name,
    glyphs: style.glyphs,
    sprite: style.sprite,
    layerCount: layers.length,
    evaluatedLayers: compactLayers.length,
    layers: compactLayers
  };
}

async function requestProviderCompletion({ providerConfig, systemPrompt, userPrompt, maxTokens }) {
  const { provider, apiKey, apiUrl, model } = providerConfig;

  if (provider === 'anthropic') {
    const url = apiUrl || 'https://api.anthropic.com/v1/messages';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${text.slice(0, 300)}`);
    }
    const data = await response.json();
    const parts = (data.content || [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text);
    return parts.join('\n').trim();
  }

  if (provider === 'openai') {
    const url = apiUrl || 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${text.slice(0, 300)}`);
    }
    const data = await response.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  }

  if (provider === 'gemini') {
    const baseUrl = apiUrl || 'https://generativelanguage.googleapis.com/v1beta/models';
    const url = `${baseUrl}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: maxTokens
        }
      })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${text.slice(0, 300)}`);
    }
    const data = await response.json();
    return (
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .filter(Boolean)
        .join('\n')
        .trim() || ''
    );
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

function parseJsonObjectFromModel(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('Model response did not contain a JSON object.');
  }
  return JSON.parse(match[0]);
}

async function evaluateStyleAccessibility({ style, providerConfig }) {
  const systemPrompt =
    'You are a map style accessibility reviewer. Evaluate this MapLibre style against WCAG 2.2 and practical cartographic accessibility principles. Return ONLY JSON with keys: helpfulAndDoneWell (string[]), standardsNotMet ({criterion:string, explanation:string}[]), fontsAndSpritesAssessment ({evaluated:boolean, findings:string[], guidance:string[]}). Each standardsNotMet item must cite a specific WCAG criterion or W3C/WAI guidance in criterion.';
  const userPrompt = `Review this compact style snapshot and provide an accessibility report:\n\n${JSON.stringify(
    getCompactStyleForA11y(style)
  )}`;
  const responseText = await requestProviderCompletion({
    providerConfig,
    systemPrompt,
    userPrompt,
    maxTokens: 2400
  });
  return parseJsonObjectFromModel(responseText);
}

async function suggestAccessibilityChanges({ style, report, providerConfig }) {
  const systemPrompt =
    'You propose accessibility improvements for a MapLibre style. Return ONLY JSON with shape {"suggestions":[{"id":"string","title":"string","reason":"string","wcagCitation":"string","patch":[RFC6902 ops]}]}. Include at most 10 suggestions. Each reason should be concise and each suggestion must include a wcagCitation such as "WCAG 2.2 - 1.4.3 Contrast (Minimum)". Use /layers/<layer_id>/... paths when possible.';
  const userPrompt = `Accessibility report:\n${JSON.stringify(report)}\n\nCurrent compact style snapshot:\n${JSON.stringify(
    getCompactStyleForA11y(style)
  )}\n\nReturn suggestions that address standardsNotMet and improve readability, contrast, and legibility.`;
  const responseText = await requestProviderCompletion({
    providerConfig,
    systemPrompt,
    userPrompt,
    maxTokens: 3200
  });
  const parsed = parseJsonObjectFromModel(responseText);
  if (!Array.isArray(parsed.suggestions)) {
    throw new Error('Suggestions response was missing "suggestions" array.');
  }
  return parsed.suggestions;
}

async function chooseSuggestions(suggestions, nonInteractive) {
  if (suggestions.length === 0) return [];
  if (nonInteractive) return [];

  console.log('\nSuggested accessibility changes:\n');
  suggestions.forEach((suggestion, index) => {
    console.log(`${index + 1}. ${suggestion.title}`);
    console.log(`   Reason: ${suggestion.reason}`);
    console.log(`   Citation: ${suggestion.wcagCitation || 'Not provided'}`);
  });

  console.log('\nChoose changes to apply:');
  console.log('  all   -> apply all suggestions');
  console.log('  none  -> apply none');
  console.log('  1,3,4 -> apply specific suggestions');

  const rl = readline.createInterface({ input, output });
  const answer = (await rl.question('\nYour selection: ')).trim().toLowerCase();
  await rl.close();

  if (answer === 'all') return suggestions.map((s) => s.id);
  if (answer === 'none' || answer.length === 0) return [];

  const selectedIndices = answer
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= suggestions.length);

  const selectedIds = new Set();
  for (const index of selectedIndices) {
    selectedIds.add(suggestions[index - 1].id);
  }
  return suggestions.filter((s) => selectedIds.has(s.id)).map((s) => s.id);
}

function applySelectedPatches(style, suggestions, selectedIds) {
  const selected = new Set(selectedIds);
  const patch = suggestions
    .filter((suggestion) => selected.has(suggestion.id))
    .flatMap((suggestion) => (Array.isArray(suggestion.patch) ? suggestion.patch : []));

  if (patch.length === 0) {
    return style;
  }

  const copy = JSON.parse(JSON.stringify(style));
  applyPatch(copy, patch, true, true);
  return copy;
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = args.stylePath;

  if (!inputPath) {
    throw new Error(
      'Please provide a path to a style JSON file.\nUsage: maplibre-gl-a11y-cli ./style.json [--config .maplibre-gl-a11y.config.json] [--non-interactive]'
    );
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  const styleName = path.basename(resolvedPath, path.extname(resolvedPath));
  const outputPath = path.join(path.dirname(resolvedPath), `${DEFAULT_OUTPUT_PREFIX}${styleName}.json`);
  const configPath = path.resolve(process.cwd(), args.configPath || DEFAULT_CONFIG_FILE);

  let style;
  try {
    style = readJsonFile(resolvedPath);
  } catch (error) {
    throw new Error(`Failed to read style file "${resolvedPath}": ${error.message}`);
  }

  let config;
  try {
    config = readJsonFile(configPath);
  } catch (error) {
    throw new Error(`Failed to read config file "${configPath}": ${error.message}`);
  }

  const providerConfig = ensureProviderConfig(config);

  console.log(`Read ${path.basename(resolvedPath)} successfully`);
  console.log(`Using provider: ${providerConfig.provider} (model: ${providerConfig.model})`);
  console.log('Running accessibility evaluation...');

  const report = await evaluateStyleAccessibility({ style, providerConfig });

  console.log('\nAccessibility report');
  console.log('--------------------');
  for (const item of report.helpfulAndDoneWell || []) {
    console.log(`+ ${item}`);
  }
  for (const item of report.standardsNotMet || []) {
    console.log(`- ${item.criterion}: ${item.explanation}`);
  }

  console.log('\nGenerating suggested style edits...');
  const suggestions = await suggestAccessibilityChanges({ style, report, providerConfig });

  const selectedIds = await chooseSuggestions(suggestions, args.nonInteractive);
  const updatedStyle = applySelectedPatches(style, suggestions, selectedIds);

  fs.writeFileSync(outputPath, `${JSON.stringify(updatedStyle, null, 2)}\n`, 'utf8');

  console.log(`\nWrote ${path.basename(outputPath)} successfully`);
  if (selectedIds.length === 0) {
    console.log('No suggestions were applied; output is a copied style baseline.');
  } else {
    console.log(`Applied ${selectedIds.length} suggestion(s).`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
