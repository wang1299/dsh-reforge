import { execFileSync } from 'node:child_process';
import { studyAdmissionContract, type StudyAdmissionDiagnostic } from '../src/study-admission-contract.js';

const contract = studyAdmissionContract();
// Predicates deliberately match ADR056/059; reasons change, admission does not.
const validator = `tree=ast.parse(sys.argv[1]); nodes=list(ast.walk(tree))
assert len(tree.body)==1 and isinstance(tree.body[0],ast.FunctionDef) and tree.body[0].name=='repair', ('function_shape','Module')
assert not tree.body[0].decorator_list and len(nodes)<=450, ('function_limits','FunctionDef')
allowed={'Module','FunctionDef','arguments','arg','Assign','AugAssign','Return','If','Raise','Try','ExceptHandler','Expr','Dict','List','Tuple','Name','Load','Store','Subscript','Constant','Attribute','Call','Compare','BinOp','UnaryOp','BoolOp','And','Or','Not','Add','Sub','USub','Eq','NotEq','Lt','LtE','Gt','GtE','Is','IsNot','In','NotIn','Pass','keyword','For'}
safe_builtins={'dict','len','ValueError','OSError'}
call_names=safe_builtins|{'persist','send'}
bound={n.arg for n in nodes if isinstance(n,ast.arg)}|{n.id for n in nodes if isinstance(n,ast.Name) and isinstance(n.ctx,ast.Store)}|{n.name for n in nodes if isinstance(n,ast.ExceptHandler) and n.name}
for n in nodes:
    assert type(n).__name__ in allowed, ('unsupported_syntax',type(n).__name__)
    if isinstance(n,ast.Name): assert not n.id.startswith('__'), ('private_name','Name')
    if isinstance(n,ast.Name) and isinstance(n.ctx,ast.Load): assert n.id in bound|safe_builtins, ('unbound_name','Name')
    if isinstance(n,ast.Name) and isinstance(n.ctx,ast.Store): assert n.id not in call_names, ('builtin_rebinding','Name')
    if isinstance(n,ast.Attribute): assert n.attr in {'get','clear','copy','update','items','values','append','pop'}, ('attribute','Attribute')
    if isinstance(n,ast.Constant) and isinstance(n.value,int): assert abs(n.value)<=10000, ('integer','Constant')
    if isinstance(n,ast.Call): assert (isinstance(n.func,ast.Name) and n.func.id in {'persist','send','dict','len','ValueError','OSError'}) or isinstance(n.func,ast.Attribute), ('call','Call')
`;
const protocol = 'import ast,sys,json\ntry:\n' + validator.trim().split('\n').map(line => '    ' + line).join('\n')
  + '\nexcept AssertionError as e:\n    rule,kind=e.args[0]\n    known=' + JSON.stringify(contract.kinds)
  + '\n    print("study-ast-v2:"+json.dumps({"schema":1,"rule":rule,"node":kind if kind in known else "other"},separators=(",",":")))'
  + '\nexcept SyntaxError:\n    print(\'study-ast-v2:{"schema":1,"rule":"syntax_error","node":"other"}\')'
  + '\nexcept (ValueError,RecursionError):\n    print(\'study-ast-v2:{"schema":1,"rule":"parse_limit","node":"other"}\')'
  + '\nelse:\n    print("study-ast-accepted-v2")\n';

export class StudyValidationError extends Error {
  constructor(readonly kind: 'rejected' | 'unknown', readonly diagnostic?: StudyAdmissionDiagnostic) {
    super(kind === 'rejected' ? 'invalid_bounded_study_function' : 'study_validator_unavailable');
  }
}
/** Unrecognized output is infrastructure unknown, never a retryable model rejection. */
export function readStudyAdmissionReceipt(receipt: string): void {
  if (receipt === 'study-ast-accepted-v2\n') return;
  if (receipt.length <= 512 && /^study-ast-v2:[^\n]+\n$/.test(receipt)) {
    let value: unknown; try { value = JSON.parse(receipt.slice('study-ast-v2:'.length)); } catch { /* unknown */ }
    const diagnostic = contract.read(value);
    if (diagnostic) throw new StudyValidationError('rejected', diagnostic);
  }
  throw new StudyValidationError('unknown');
}
export function validateStudyCode(python: string, code: string, options?: { env: NodeJS.ProcessEnv; isolated: true }): void {
  if (Buffer.byteLength(code) > 4096) throw new StudyValidationError('rejected', { schema: 1, rule: 'code_size', node: 'other' });
  let receipt: string;
  try { receipt = execFileSync(python, [...(options ? ['-I', '-S', '-B'] : ['-I']), '-c', protocol, code], { windowsHide: true,
    ...(options ? { env: options.env } : {}), stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 5000, maxBuffer: 512 }).replaceAll('\r\n', '\n'); }
  catch { throw new StudyValidationError('unknown'); }
  readStudyAdmissionReceipt(receipt);
}
