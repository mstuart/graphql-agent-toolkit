import { tokenize } from './tokenizer.js';
import type { ParsedSchema, SchemaField, SchemaType } from '../types/index.js';

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

const buildDocument = (typeName: string, type: SchemaType): DocumentVector => {
  const fieldText = [...type.fields, ...type.inputFields, ...type.enumValues].flatMap((field) => [
    field.name,
    field.description ?? '',
  ]);
  const tokens = tokenize([typeName, type.description ?? '', ...fieldText].join(' '));
  return { tfidf: new Map(), tokens, typeName };
};

const computeIdf = (documents: DocumentVector[]): Map<string, number> => {
  const termDocumentFrequency = new Map<string, number>();
  for (const document of documents) {
    const uniqueTokens = new Set(document.tokens);
    for (const token of uniqueTokens) {
      termDocumentFrequency.set(token, (termDocumentFrequency.get(token) ?? 0) + 1);
    }
  }

  return new Map(
    Array.from(termDocumentFrequency, ([term, frequency]) => [
      term,
      Math.log(1 + documents.length / (1 + frequency)),
    ]),
  );
};

const computeTfidf = (
  tokens: string[],
  idf: Map<string, number>,
  documentCount: number,
): Map<string, number> => {
  const termFrequency = new Map<string, number>();
  for (const token of tokens) {
    termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  }

  return new Map(
    Array.from(termFrequency, ([term, count]) => {
      const idfValue = idf.get(term) ?? Math.log(1 + documentCount);
      return [term, (count / tokens.length) * idfValue];
    }),
  );
};

const cosineSimilarity = (left: Map<string, number>, right: Map<string, number>): number => {
  let dotProduct = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const [term, value] of left) {
    leftNorm += value * value;
    dotProduct += value * (right.get(term) ?? 0);
  }
  for (const value of right.values()) {
    rightNorm += value * value;
  }

  return leftNorm === 0 || rightNorm === 0
    ? 0
    : dotProduct / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

const formatField = (field: SchemaField): string => {
  const description = field.description ? ` — ${field.description}` : '';
  const parameters =
    field.args.length > 0 ? `(${field.args.map((argument) => argument.name).join(', ')})` : '';
  return `    ${field.name}${parameters}${description}`;
};

const formatNamedDescription = ({
  description,
  name,
}: {
  description: string | null;
  name: string;
}): string => {
  const suffix = description ? ` — ${description}` : '';
  return `    ${name}${suffix}`;
};

/**
 * SchemaNavigator provides semantic search over a GraphQL schema
 * using TF-IDF and cosine similarity.
 */
export class SchemaNavigator {
  private schema: ParsedSchema | null = null;
  private documents: DocumentVector[] = [];
  private idf = new Map<string, number>();

  /**
   * Index a parsed schema for semantic search.
   */
  index(schema: ParsedSchema): void {
    this.schema = schema;
    this.documents = schema.types
      .entries()
      .filter(([, type]) => type.kind !== 'SCALAR')
      .map(([typeName, type]) => buildDocument(typeName, type))
      .toArray();

    // Compute IDF
    this.idf = computeIdf(this.documents);

    // Compute TF-IDF for each document
    this.documents = this.documents.map((document) => ({
      ...document,
      tfidf: computeTfidf(document.tokens, this.idf, this.documents.length),
    }));
  }

  /**
   * Search the schema for types matching the query.
   */
  search(query: string, limit = 5): SearchResult[] {
    if (!this.schema || this.documents.length === 0) {
      return [];
    }

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const queryTfidf = computeTfidf(queryTokens, this.idf, this.documents.length);

    const scored = this.documents
      .flatMap((document): SearchResult[] => {
        const score = cosineSimilarity(queryTfidf, document.tfidf);
        const type = this.schema?.types.get(document.typeName);
        return type && score > 0
          ? [
              {
                description: type.description,
                kind: type.kind,
                score,
                typeName: document.typeName,
              },
            ]
          : [];
      })
      .toSorted((left, right) => right.score - left.score);

    return scored.slice(0, limit);
  }

  /**
   * Get formatted context for a specific type.
   */
  getTypeContext(typeName: string): string | null {
    if (!this.schema) {
      return null;
    }

    const type = this.schema.types.get(typeName);
    if (!type) {
      return null;
    }

    const lines: string[] = [`${type.kind} ${type.name}`];

    if (type.description) {
      lines.push(`  Description: ${type.description}`);
    }

    if (type.fields.length > 0) {
      lines.push('  Fields:', ...type.fields.map(formatField));
    }

    if (type.inputFields.length > 0) {
      lines.push('  Input Fields:', ...type.inputFields.map(formatNamedDescription));
    }

    if (type.enumValues.length > 0) {
      lines.push('  Enum Values:', ...type.enumValues.map(formatNamedDescription));
    }

    if (type.interfaces.length > 0) {
      lines.push(`  Implements: ${type.interfaces.join(', ')}`);
    }

    if (type.possibleTypes.length > 0) {
      lines.push(`  Possible Types: ${type.possibleTypes.join(', ')}`);
    }

    return lines.join('\n');
  }
}
