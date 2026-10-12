import { packagePath, type WorkflowCondition } from './authoring.js';

export const conditionOperators = ['equals', 'notEquals', 'contains', 'startsWith', 'endsWith', 'greaterThan', 'lessThan'] as const;

export function validateCondition(value: WorkflowCondition) {
  if (!value || !['literal', 'file'].includes(value.source) || !conditionOperators.includes(value.operator)
    || typeof value.input !== 'string' || value.input.length > 32000 || typeof value.match !== 'string'
    || value.match.length > 32000 || typeof value.caseSensitive !== 'boolean') throw new Error('If-else 条件参数无效。');
  if (value.source === 'file') packagePath(value.input);
  if (['greaterThan', 'lessThan'].includes(value.operator) && (!value.match.trim() || !Number.isFinite(Number(value.match)))) throw new Error('数值条件需要有效的匹配数字。');
}

export function compareCondition(value: WorkflowCondition, input: string): boolean {
  validateCondition(value);
  const a = value.caseSensitive ? input : input.toLocaleLowerCase('en-US');
  const b = value.caseSensitive ? value.match : value.match.toLocaleLowerCase('en-US');
  switch (value.operator) {
    case 'equals': return a === b;
    case 'notEquals': return a !== b;
    case 'contains': return a.includes(b);
    case 'startsWith': return a.startsWith(b);
    case 'endsWith': return a.endsWith(b);
    default: {
      if (!input.trim() || !Number.isFinite(Number(input))) throw new Error('条件输入不是有效数字。');
      return value.operator === 'greaterThan' ? Number(input) > Number(value.match) : Number(input) < Number(value.match);
    }
  }
}
