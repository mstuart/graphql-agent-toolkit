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
  includeMetadata: true,
  maxDepth: 3,
  maxItems: 5,
  maxStringLength: 200,
};

/**
 * Summarize a GraphQL response by truncating arrays, limiting depth,
 * and shortening long strings.
 */
export const summarizeResponse = (
  data: unknown,
  config?: Partial<SummaryConfig>,
): { summary: unknown; metadata: SummaryMetadata } => {
  const resolvedConfig = { ...DEFAULT_CONFIG, ...config };
  const originalSize = JSON.stringify(data).length;
  let isTruncated = false;

  const countItems = (value: unknown): number => {
    if (Array.isArray(value)) {
      return value.length;
    }
    if (value && typeof value === 'object') {
      let count = 0;
      for (const v of Object.values(value as Record<string, unknown>)) {
        count += Array.isArray(v) ? v.length : countItems(v);
      }
      return count;
    }
    return 0;
  };

  const totalItems = countItems(data);

  const summarize = (value: unknown, depth: number): unknown => {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      if (value.length > resolvedConfig.maxStringLength) {
        isTruncated = true;
        return `${value.slice(0, resolvedConfig.maxStringLength)}...`;
      }
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      if (depth >= resolvedConfig.maxDepth) {
        isTruncated = true;
        return `[...${value.length} items]`;
      }

      const items = value
        .slice(0, resolvedConfig.maxItems)
        .map((item) => summarize(item, depth + 1));

      if (value.length > resolvedConfig.maxItems) {
        isTruncated = true;
        if (resolvedConfig.includeMetadata) {
          return Object.assign(items, {
            _meta: { showing: resolvedConfig.maxItems, totalCount: value.length },
          });
        }
      }

      return items;
    }

    if (typeof value === 'object') {
      if (depth >= resolvedConfig.maxDepth) {
        const keys = Object.keys(value as Record<string, unknown>);
        isTruncated = true;
        return `{...${keys.length} keys}`;
      }

      const result: Record<string, unknown> = {};
      for (const [key, currentValue] of Object.entries(value as Record<string, unknown>)) {
        result[key] = summarize(currentValue, depth + 1);
      }
      return result;
    }

    return value;
  };

  const summary = summarize(data, 0);

  return {
    metadata: {
      originalSize,
      totalItems,
      truncated: isTruncated,
    },
    summary,
  };
};

const renderer = {
  markdown: (value: unknown, indent: number): string => {
    if (value === null || value === undefined) {
      return 'null';
    }

    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return '(empty list)';
      }

      const lines: string[] = [];
      const meta = (value as unknown as Record<string, unknown>)._meta as
        { totalCount: number; showing: number } | undefined;

      for (const item of value) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          // Object items - render as nested bullets
          const objectLines = renderer.objectAsBullets(item as Record<string, unknown>, indent + 1);
          lines.push(`${'  '.repeat(indent)}- ${objectLines}`);
        } else {
          lines.push(`${'  '.repeat(indent)}- ${renderer.markdown(item, indent + 1)}`);
        }
      }

      if (meta) {
        lines.push(`${'  '.repeat(indent)}- _(${meta.totalCount - meta.showing} more items...)_`);
      }

      return lines.join('\n');
    }

    if (typeof value === 'object') {
      return renderer.objectAsSection(value as Record<string, unknown>, indent);
    }

    return String(value);
  },

  objectAsBullets: (object: Record<string, unknown>, indent: number): string => {
    const entries = Object.entries(object).filter(([k]) => k !== '_meta');
    if (entries.length === 0) {
      return '(empty)';
    }

    const parts: string[] = [];
    let isFirst = true;

    for (const [key, value] of entries) {
      if (typeof value === 'object' && value !== null) {
        if (isFirst) {
          parts.push(`**${key}**: ${renderer.markdown(value, indent + 1)}`);
          isFirst = false;
        } else {
          parts.push(`${'  '.repeat(indent)}**${key}**: ${renderer.markdown(value, indent + 1)}`);
        }
      } else {
        const rendered = renderer.markdown(value, indent);
        if (isFirst) {
          parts.push(`**${key}**: ${rendered}`);
          isFirst = false;
        } else {
          parts.push(`${'  '.repeat(indent)}**${key}**: ${rendered}`);
        }
      }
    }

    return parts.join('\n');
  },

  objectAsSection: (object: Record<string, unknown>, indent: number): string => {
    const entries = Object.entries(object).filter(([k]) => k !== '_meta');
    if (entries.length === 0) {
      return '(empty)';
    }

    const lines: string[] = [];
    const headerLevel = Math.min(indent + 2, 6);
    const header = '#'.repeat(headerLevel);

    for (const [key, value] of entries) {
      if (typeof value === 'object' && value !== null) {
        lines.push(`${header} ${key}`, renderer.markdown(value, indent + 1));
      } else {
        lines.push(`- **${key}**: ${renderer.markdown(value, indent)}`);
      }
    }

    return lines.join('\n');
  },
};

/**
 * Format data as clean markdown suitable for LLM context.
 */
export const formatForLLM = (data: unknown, config?: Partial<SummaryConfig>): string => {
  const { summary } = summarizeResponse(data, config);
  return renderer.markdown(summary, 0);
};
