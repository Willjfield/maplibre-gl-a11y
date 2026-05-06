#!/usr/bin/env node

import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import jsonPatch from 'fast-json-patch';

const { applyPatch } = jsonPatch;

const DEFAULT_CONFIG_FILE = '.maplibre-gl-a11y.config.json';
const DEFAULT_OUTPUT_PREFIX = 'a11y_';
const PROVIDER_TIMEOUT_MS = 90000;
const WAITING_LOG_INTERVAL_MS = 8000;
const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-pro'
};
const DEPRECATED_ANTHROPIC_MODELS = {
  'claude-3-5-haiku-latest': 'claude-sonnet-4-6'
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
    if (!args.configPath) {
      args.configPath = arg;
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

  let selectedModel = providerConfig.model || DEFAULT_MODEL_BY_PROVIDER[provider];
  if (provider === 'anthropic' && DEPRECATED_ANTHROPIC_MODELS[selectedModel]) {
    const replacementModel = DEPRECATED_ANTHROPIC_MODELS[selectedModel];
    console.warn(
      `Warning: Anthropic model "${selectedModel}" is deprecated. Using "${replacementModel}" instead.`
    );
    selectedModel = replacementModel;
  }

  return {
    provider,
    apiKey: providerConfig.apiKey,
    apiUrl: providerConfig.apiUrl,
    model: selectedModel
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

async function withWaitingNotice(label, operation) {
  const startedAt = Date.now();
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const dotSuffix = '.'.repeat((tick % 3) + 1);
    console.log(`${label} (still waiting ${elapsedSeconds}s)${dotSuffix}`);
  }, WAITING_LOG_INTERVAL_MS);

  try {
    return await operation();
  } finally {
    clearInterval(timer);
  }
}

async function requestProviderCompletion({ providerConfig, systemPrompt, userPrompt, maxTokens }) {
  const { provider, apiKey, apiUrl, model } = providerConfig;
  const requestOptionsBase = {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  };

  if (provider === 'anthropic') {
    const url = apiUrl || 'https://api.anthropic.com/v1/messages';
    const makeAnthropicRequest = async (modelName) =>
      fetch(url, {
        ...requestOptionsBase,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });
    let response = await withWaitingNotice('Waiting for Anthropic response', () =>
      makeAnthropicRequest(model)
    );
    if (!response.ok && response.status === 404) {
      const errorText = await response.text();
      const isModelNotFound = /not_found_error|model/i.test(errorText);
      if (isModelNotFound && model !== DEFAULT_MODEL_BY_PROVIDER.anthropic) {
        console.warn(
          `Warning: Anthropic model "${model}" was not found. Retrying with "${DEFAULT_MODEL_BY_PROVIDER.anthropic}".`
        );
        response = await withWaitingNotice('Retrying Anthropic request', () =>
          makeAnthropicRequest(DEFAULT_MODEL_BY_PROVIDER.anthropic)
        );
      } else {
        throw new Error(`Anthropic API error ${response.status}: ${errorText.slice(0, 300)}`);
      }
    }
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
    const response = await withWaitingNotice('Waiting for OpenAI response', () =>
      fetch(url, {
        ...requestOptionsBase,
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
      })
    );
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
    const response = await withWaitingNotice('Waiting for Gemini response', () =>
      fetch(url, {
        ...requestOptionsBase,
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
      })
    );
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
  if (!trimmed) {
    throw new Error('Model response was empty.');
  }

  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeFenceMatch && codeFenceMatch[1]) {
    const fenced = codeFenceMatch[1].trim();
    try {
      return JSON.parse(fenced);
    } catch {
      // Continue with fallback extraction.
    }
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with fallback extraction.
  }

  const startIndex = trimmed.indexOf('{');
  if (startIndex === -1) {
    throw new Error('Model response did not contain a JSON object.');
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;
  for (let i = startIndex; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = trimmed.slice(startIndex, i + 1);
        return JSON.parse(candidate);
      }
    }
  }

  throw new Error('Model response did not contain a complete JSON object.');
}

async function evaluateStyleAccessibility({ style, providerConfig }) {
  const systemPrompt =
    'You are a map style accessibility reviewer. Evaluate this MapLibre style against WCAG 2.2 and practical cartographic accessibility principles. Return ONLY JSON with keys: helpfulAndDoneWell (string[]), standardsNotMet ({criterion:string, explanation:string}[]), fontsAndSpritesAssessment ({evaluated:boolean, findings:string[], guidance:string[]}). Each standardsNotMet item must cite a specific WCAG criterion or W3C/WAI guidance in criterion.';
  const baseUserPrompt = `Review this compact style snapshot and provide an accessibility report:\n\n${JSON.stringify(
    getCompactStyleForA11y(style)
  )}`;
  const prompts = [
    baseUserPrompt,
    `${baseUserPrompt}\n\nIMPORTANT: Return ONLY valid JSON. No markdown fences, no commentary, and keep lists concise.`
  ];

  let lastParseError;
  for (let attempt = 0; attempt < prompts.length; attempt += 1) {
    const responseText = await requestProviderCompletion({
      providerConfig,
      systemPrompt,
      userPrompt: prompts[attempt],
      maxTokens: attempt === 0 ? 2400 : 4000
    });
    try {
      return parseJsonObjectFromModel(responseText);
    } catch (error) {
      lastParseError = error;
    }
  }
  throw lastParseError;
}

async function suggestAccessibilityChanges({ style, report, providerConfig }) {
  const systemPrompt =
    'You propose accessibility improvements for a MapLibre style. Validate every suggestion against the MapLibre Style Spec (https://maplibre.org/maplibre-style-spec/) before returning it. Return ONLY JSON with shape {"suggestions":[{"id":"string","title":"string","reason":"string","wcagCitation":"string","patch":[RFC6902 ops]}]}. Include at most 10 suggestions. Each reason should be concise and each suggestion must include a wcagCitation such as "WCAG 2.2 - 1.4.3 Contrast (Minimum)". Use /layers/<layer_id>/... paths when possible. For expression edits, ALWAYS return complete valid expressions (for interpolate include all stop/value pairs and final value).';
  const baseUserPrompt = `Accessibility report:\n${JSON.stringify(report)}\n\nCurrent compact style snapshot:\n${JSON.stringify(
    getCompactStyleForA11y(style)
  )}\n\nReturn suggestions that address standardsNotMet and improve readability, contrast, and legibility.`;
  const prompts = [
    baseUserPrompt,
    `${baseUserPrompt}\n\nIMPORTANT: Return ONLY valid JSON. No markdown fences, no commentary. Every patch MUST be valid against the style spec and syntactically complete.`
  ];
  let parsed;
  let lastParseError;
  for (let attempt = 0; attempt < prompts.length; attempt += 1) {
    const responseText = await requestProviderCompletion({
      providerConfig,
      systemPrompt,
      userPrompt: prompts[attempt],
      maxTokens: attempt === 0 ? 3200 : 5000
    });
    try {
      parsed = parseJsonObjectFromModel(responseText);
      break;
    } catch (error) {
      lastParseError = error;
    }
  }
  if (!parsed) {
    throw lastParseError;
  }
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

  const layerIndexById = new Map();
  const layers = Array.isArray(style.layers) ? style.layers : [];
  for (let index = 0; index < layers.length; index += 1) {
    const layerId = layers[index]?.id;
    if (typeof layerId === 'string') {
      layerIndexById.set(layerId, index);
    }
  }

  const normalizedPatch = patch.flatMap((operation) => {
    if (!operation || typeof operation !== 'object' || typeof operation.path !== 'string') {
      return [];
    }
    const match = operation.path.match(/^\/layers\/([^/]+)(\/.*)?$/);
    if (!match) {
      return [operation];
    }

    const layerToken = decodeURIComponent(match[1]);
    if (/^\d+$/.test(layerToken)) {
      return [operation];
    }

    const layerIndex = layerIndexById.get(layerToken);
    if (typeof layerIndex !== 'number') {
      console.warn(`Warning: skipping patch operation for unknown layer id "${layerToken}".`);
      return [];
    }

    const suffix = match[2] || '';
    return [{ ...operation, path: `/layers/${layerIndex}${suffix}` }];
  });

  if (normalizedPatch.length === 0) {
    console.warn('Warning: no applicable patch operations were found after normalization.');
    return style;
  }

  let copy = JSON.parse(JSON.stringify(style));
  const getInvalidInterpolateExpressions = (styleObject) => {
    const invalid = [];
    const layersInStyle = Array.isArray(styleObject.layers) ? styleObject.layers : [];
    const sections = ['layout', 'paint'];

    for (let layerIndex = 0; layerIndex < layersInStyle.length; layerIndex += 1) {
      const layer = layersInStyle[layerIndex];
      for (const sectionName of sections) {
        const section = layer?.[sectionName];
        if (!section || typeof section !== 'object') {
          continue;
        }
        for (const [propertyName, propertyValue] of Object.entries(section)) {
          if (!Array.isArray(propertyValue) || propertyValue[0] !== 'interpolate') {
            continue;
          }
          if (propertyValue.length < 5 || (propertyValue.length - 3) % 2 !== 0) {
            invalid.push(`layers[${layerIndex}].${sectionName}.${propertyName}`);
          }
        }
      }
    }
    return invalid;
  };

  const repairInterpolateExpression = (value) => {
    if (!Array.isArray(value) || value[0] !== 'interpolate') {
      return value;
    }
    if (value.length >= 5 && (value.length - 3) % 2 === 0) {
      return value;
    }
    if (value.length < 6) {
      return value;
    }
    const repaired = [...value];
    const previousValue = repaired[repaired.length - 2];
    repaired.push(previousValue);
    return repaired;
  };

  const repairOperationValue = (value) => {
    if (Array.isArray(value)) {
      const maybeRepairedInterpolate = repairInterpolateExpression(value);
      return maybeRepairedInterpolate.map((entry) => repairOperationValue(entry));
    }
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, entryValue] of Object.entries(value)) {
        out[key] = repairOperationValue(entryValue);
      }
      return out;
    }
    return value;
  };

  let appliedCount = 0;
  for (const operation of normalizedPatch) {
    const snapshot = JSON.parse(JSON.stringify(copy));
    const operationToApply = {
      ...operation,
      value: repairOperationValue(operation.value)
    };
    try {
      applyPatch(copy, [operationToApply], true, true);
      const invalidInterpolatePaths = getInvalidInterpolateExpressions(copy);
      if (invalidInterpolatePaths.length > 0) {
        copy = snapshot;
        console.warn(
          `Warning: skipping operation "${operation.op}" at "${operation.path}" because it created invalid interpolate expression(s): ${invalidInterpolatePaths.join(', ')}`
        );
        continue;
      }
      appliedCount += 1;
    } catch (error) {
      copy = snapshot;
      console.warn(
        `Warning: skipping invalid patch operation "${operation.op}" at "${operation.path}": ${error.message}`
      );
    }
  }
  if (appliedCount === 0) {
    console.warn('Warning: no valid patch operations could be applied. Returning baseline style.');
    return style;
  }
  return copy;
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = args.stylePath;

  if (!inputPath) {
    throw new Error(
      'Please provide a path to a style JSON file.\nUsage: maplibre-gl-a11y-cli ./style.json [./path/to/config.json] [--config .maplibre-gl-a11y.config.json] [--non-interactive]'
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
  let suggestions = [];
  let suggestionError;
  try {
    suggestions = await suggestAccessibilityChanges({ style, report, providerConfig });
  } catch (error) {
    suggestionError = error;
    console.warn(`Warning: failed to generate suggestions. Writing baseline output. (${error.message})`);
  }

  const selectedIds = suggestionError ? [] : await chooseSuggestions(suggestions, args.nonInteractive);
  const updatedStyle = suggestionError ? style : applySelectedPatches(style, suggestions, selectedIds);

  fs.writeFileSync(outputPath, `${JSON.stringify(updatedStyle, null, 2)}\n`, 'utf8');

  console.log(`\nWrote ${path.basename(outputPath)} successfully`);
  if (suggestionError) {
    console.log('No suggestions were applied because suggestion generation failed.');
  } else if (selectedIds.length === 0) {
    console.log('No suggestions were applied; output is a copied style baseline.');
  } else {
    console.log(`Applied ${selectedIds.length} suggestion(s).`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
