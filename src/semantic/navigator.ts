import type { ParsedSchema } from '../types/index.js';
import { tokenize } from './tokenizer.js';

export interface SearchResult {
  typeName: string;
  score: number;
  kind: string;
  description: string | null;
}

interface DocumentVector {
  typeName: string;
  tokens: string[];
  tfidf: Map<string, number>;
}

/**
 * SchemaNavigator provides semantic search over a GraphQL schema
 * using TF-IDF and cosine similarity.
 */
export class SchemaNavigator {
  private schema: ParsedSchema | null = null;
  private documents: DocumentVector[] = [];
  private idf: Map<string, number> = new Map();

  /**
   * Index a parsed schema for semantic search.
   */
  index(schema: ParsedSchema): void {
    this.schema = schema;
    this.documents = [];

    // Build document for each type
    for (const [typeName, type] of schema.types) {
      // Skip scalar types for search
      if (type.kind === 'SCALAR') continue;

      const textParts: string[] = [typeName];

      if (type.description) {
        textParts.push(type.description);
      }

      for (const field of type.fields) {
        textParts.push(field.name);
        if (field.description) {
          textParts.push(field.description);
        }
      }

      for (const field of type.inputFields) {
        textParts.push(field.name);
        if (field.description) {
          textParts.push(field.description);
        }
      }

      for (const ev of type.enumValues) {
        textParts.push(ev.name);
        if (ev.description) {
          textParts.push(ev.description);
        }
      }

      const tokens = tokenize(textParts.join(' '));
      this.documents.push({ typeName, tokens, tfidf: new Map() });
    }

    // Compute IDF
    this.computeIdf();

    // Compute TF-IDF for each document
    for (const doc of this.documents) {
      doc.tfidf = this.computeTfidf(doc.tokens);
    }
  }

  /**
   * Search the schema for types matching the query.
   */
  search(query: string, limit: number = 5): SearchResult[] {
    if (!this.schema || this.documents.length === 0) {
      return [];
    }

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const queryTfidf = this.computeTfidf(queryTokens);

    const scored: SearchResult[] = [];

    for (const doc of this.documents) {
      const score = this.cosineSimilarity(queryTfidf, doc.tfidf);
      if (score > 0) {
        const type = this.schema.types.get(doc.typeName)!;
        scored.push({
          typeName: doc.typeName,
          score,
          kind: type.kind,
          description: type.description,
        });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit);
  }

  /**
   * Get formatted context for a specific type.
   */
  getTypeContext(typeName: string): string | null {
    if (!this.schema) return null;

    const type = this.schema.types.get(typeName);
    if (!type) return null;

    const lines: string[] = [];
    lines.push(`${type.kind} ${type.name}`);

    if (type.description) {
      lines.push(`  Description: ${type.description}`);
    }

    if (type.fields.length > 0) {
      lines.push('  Fields:');
      for (const field of type.fields) {
        const desc = field.description ? ` — ${field.description}` : '';
        const args = field.args.length > 0
          ? `(${field.args.map((a) => a.name).join(', ')})`
          : '';
        lines.push(`    ${field.name}${args}${desc}`);
      }
    }

    if (type.inputFields.length > 0) {
      lines.push('  Input Fields:');
      for (const field of type.inputFields) {
        const desc = field.description ? ` — ${field.description}` : '';
        lines.push(`    ${field.name}${desc}`);
      }
    }

    if (type.enumValues.length > 0) {
      lines.push('  Enum Values:');
      for (const ev of type.enumValues) {
        const desc = ev.description ? ` — ${ev.description}` : '';
        lines.push(`    ${ev.name}${desc}`);
      }
    }

    if (type.interfaces.length > 0) {
      lines.push(`  Implements: ${type.interfaces.join(', ')}`);
    }

    if (type.possibleTypes.length > 0) {
      lines.push(`  Possible Types: ${type.possibleTypes.join(', ')}`);
    }

    return lines.join('\n');
  }

  private computeIdf(): void {
    const docCount = this.documents.length;
    const termDocFreq = new Map<string, number>();

    for (const doc of this.documents) {
      const uniqueTokens = new Set(doc.tokens);
      for (const token of uniqueTokens) {
        termDocFreq.set(token, (termDocFreq.get(token) ?? 0) + 1);
      }
    }

    this.idf = new Map();
    for (const [term, freq] of termDocFreq) {
      // Use smoothed IDF to avoid zero values when a term appears in all documents
      this.idf.set(term, Math.log(1 + docCount / (1 + freq)));
    }
  }

  private computeTfidf(tokens: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    const tfidf = new Map<string, number>();
    for (const [term, count] of tf) {
      const idfVal = this.idf.get(term) ?? Math.log(1 + this.documents.length);
      tfidf.set(term, (count / tokens.length) * idfVal);
    }

    return tfidf;
  }

  private cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const [term, val] of a) {
      normA += val * val;
      const bVal = b.get(term);
      if (bVal !== undefined) {
        dotProduct += val * bVal;
      }
    }

    for (const val of b.values()) {
      normB += val * val;
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
