/** Finite metadata only. Shared by the worker receipt, feedback and local report reader. */
export function studyAdmissionContract() {
  const rules = ['code_size', 'function_shape', 'function_limits', 'unsupported_syntax', 'private_name', 'unbound_name',
    'builtin_rebinding', 'attribute', 'integer', 'call', 'syntax_error', 'parse_limit'] as const;
  const kinds = ['other', 'Module', 'FunctionDef', 'arguments', 'arg', 'Assign', 'AugAssign', 'Return', 'If', 'Raise', 'Try',
    'ExceptHandler', 'Expr', 'Dict', 'List', 'Tuple', 'Name', 'Load', 'Store', 'Subscript', 'Constant', 'Attribute', 'Call',
    'Compare', 'BinOp', 'UnaryOp', 'BoolOp', 'And', 'Or', 'Not', 'Add', 'Sub', 'USub', 'Eq', 'NotEq', 'Lt', 'LtE', 'Gt',
    'GtE', 'Is', 'IsNot', 'In', 'NotIn', 'Pass', 'keyword', 'For', 'Set', 'SetComp', 'DictComp', 'ListComp', 'GeneratorExp',
    'Lambda', 'Import', 'ImportFrom', 'With', 'While', 'AsyncFunctionDef', 'Await', 'Yield', 'YieldFrom', 'ClassDef',
    'NamedExpr', 'Delete', 'Global', 'Nonlocal', 'JoinedStr', 'FormattedValue', 'Mult', 'Div', 'Pow', 'Mod', 'comprehension'] as const;
  type Diagnostic = { schema: 1; rule: typeof rules[number]; node: typeof kinds[number] };
  function read(value: unknown): Diagnostic | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (Object.keys(v).sort().join(',') !== 'node,rule,schema' || v.schema !== 1
      || !rules.includes(v.rule as Diagnostic['rule']) || !kinds.includes(v.node as Diagnostic['node'])) return null;
    return { schema: 1, rule: v.rule as Diagnostic['rule'], node: v.node as Diagnostic['node'] };
  }
  const allowedSubset = 'Bounded Python policy (unchanged): one undecorated def repair; <=4096 UTF-8 bytes and <=450 AST nodes. '
    + 'Statements: assign, augmented assign, return, if, raise, try/except, expression, pass, for. '
    + 'Values: dict/list/tuple, subscripts, constants, names, comparisons, boolean operations, addition/subtraction/negation. '
    + 'Only built-in call names dict, len, ValueError, OSError, and task parameters persist/send. '
    + 'Only attributes get, clear, copy, update, items, values, append, pop. '
    + 'No names starting __, unbound reads, reassignment of those call names, or integers with absolute value >10000. '
    + 'No imports, comprehensions, sets, lambdas or other syntax outside this subset. Keep the original task contract.';
  return { rules, kinds, read, allowedSubset };
}
export type StudyAdmissionDiagnostic = NonNullable<ReturnType<ReturnType<typeof studyAdmissionContract>['read']>>;
