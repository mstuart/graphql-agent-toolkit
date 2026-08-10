export { buildOperation } from './builder.js';
export type { GeneratedOperation, VariableDefinition, BuildOperationOptions } from './builder.js';
export {
  isRequired,
  typeReferenceToString,
  // Preserve the original public function name for existing consumers.
  typeReferenceToString as typeRefToString,
  unwrapType,
} from './variables.js';
