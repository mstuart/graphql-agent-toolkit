export interface SummaryConfig {
  maxItems: number;
  maxDepth: number;
  maxStringLength: number;
  includeMetadata: boolean;
}

export interface SummaryMetadata {
  totalItems: number;
  truncated: boolean;
  originalSize: number;
}

const DEFAULT_CONFIG: SummaryConfig = {
  maxItems: 5,
  maxDepth: 3,
  maxStringLength: 200,
  includeMetadata: true,
};

/**
 * Summarize a GraphQL response by truncating arrays, limiting depth,
 * and shortening long strings.
 */
export function summarizeResponse(
  data: unknown,
  config?: Partial<SummaryConfig>,
): { summary: unknown; metadata: SummaryMetadata } {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const originalSize = JSON.stringify(data).length;
  let truncated = false;
  let totalItems = 0;

  function countItems(value: unknown): number {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') {
      let count = 0;
      for (const v of Object.values(value as Record<string, unknown>)) {
        if (Array.isArray(v)) count += v.length;
        else count += countItems(v);
      }
      return count;
    }
    return 0;
  }

  totalItems = countItems(data);

  function summarize(value: unknown, depth: number): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
      if (value.length > cfg.maxStringLength) {
        truncated = true;
        return value.slice(0, cfg.maxStringLength) + '...';
      }
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      if (depth >= cfg.maxDepth) {
        truncated = true;
        return `[...${value.length} items]`;
      }

      const items = value.slice(0, cfg.maxItems).map((item) => summarize(item, depth + 1));

      if (value.length > cfg.maxItems) {
        truncated = true;
        if (cfg.includeMetadata) {
          return Object.assign(items, {
            _meta: { totalCount: value.length, showing: cfg.maxItems },
          });
        }
      }

      return items;
    }

    if (typeof value === 'object') {
      if (depth >= cfg.maxDepth) {
        const keys = Object.keys(value as Record<string, unknown>);
        truncated = true;
        return `{...${keys.length} keys}`;
      }

      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        result[key] = summarize(val, depth + 1);
      }
      return result;
    }

    return value;
  }

  const summary = summarize(data, 0);

  return {
    summary,
    metadata: {
      totalItems,
      truncated,
      originalSize,
    },
  };
}

/**
 * Format data as clean markdown suitable for LLM context.
 */
export function formatForLLM(
  data: unknown,
  config?: Partial<SummaryConfig>,
): string {
  const { summary } = summarizeResponse(data, config);
  return renderMarkdown(summary, 0);
}

function renderMarkdown(value: unknown, indent: number): string {
  if (value === null || value === undefined) return 'null';

  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '(empty list)';

    const lines: string[] = [];
    const meta = (value as any)._meta;

    for (const item of value) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        // Object items - render as nested bullets
        const objLines = renderObjectAsBullets(item as Record<string, unknown>, indent + 1);
        lines.push(`${'  '.repeat(indent)}- ${objLines}`);
      } else {
        lines.push(`${'  '.repeat(indent)}- ${renderMarkdown(item, indent + 1)}`);
      }
    }

    if (meta) {
      lines.push(`${'  '.repeat(indent)}- _(${meta.totalCount - meta.showing} more items...)_`);
    }

    return lines.join('\n');
  }

  if (typeof value === 'object') {
    return renderObjectAsSection(value as Record<string, unknown>, indent);
  }

  return String(value);
}

function renderObjectAsBullets(obj: Record<string, unknown>, indent: number): string {
  const entries = Object.entries(obj).filter(([k]) => k !== '_meta');
  if (entries.length === 0) return '(empty)';

  const parts: string[] = [];
  let first = true;

  for (const [key, value] of entries) {
    if (typeof value === 'object' && value !== null) {
      if (first) {
        parts.push(`**${key}**: ${renderMarkdown(value, indent + 1)}`);
        first = false;
      } else {
        parts.push(`${'  '.repeat(indent)}**${key}**: ${renderMarkdown(value, indent + 1)}`);
      }
    } else {
      const rendered = renderMarkdown(value, indent);
      if (first) {
        parts.push(`**${key}**: ${rendered}`);
        first = false;
      } else {
        parts.push(`${'  '.repeat(indent)}**${key}**: ${rendered}`);
      }
    }
  }

  return parts.join('\n');
}

function renderObjectAsSection(obj: Record<string, unknown>, indent: number): string {
  const entries = Object.entries(obj).filter(([k]) => k !== '_meta');
  if (entries.length === 0) return '(empty)';

  const lines: string[] = [];
  const headerLevel = Math.min(indent + 2, 6);
  const header = '#'.repeat(headerLevel);

  for (const [key, value] of entries) {
    if (typeof value === 'object' && value !== null) {
      lines.push(`${header} ${key}`);
      lines.push(renderMarkdown(value, indent + 1));
    } else {
      lines.push(`- **${key}**: ${renderMarkdown(value, indent)}`);
    }
  }

  return lines.join('\n');
}
