/* Parse fixed arithmetic expressions and serialize safe MathML; never evaluate JavaScript. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const modules = root ? (root.BBQuestionModules || (root.BBQuestionModules = {})) : null;
  const api = node
    ? factory(require('./shared.js'))
    : factory(modules['shared']);
  if (node) module.exports = api;
  if (root) modules['arithmetic'] = api;
})(typeof window !== 'undefined' ? window : null, function (shared) {
  'use strict';

  const { ValidationError, escapeXml, normalizeArabicDigits } = shared;

  function tokenizeArithmeticFormula(source) {
    const normalized = normalizeArabicDigits(source)
      .replace(/[×·]/g, '*')
      .replace(/÷/g, '/')
      .replace(/[−–—]/g, '-');
    if (!normalized.trim() || normalized.length > 1000) throw new ValidationError('صيغة CALC فارغة أو أطول من 1000 حرف.');
    const tokens = [];
    let index = 0;
    while (index < normalized.length) {
      if (/\s/.test(normalized[index])) {
        index += 1;
        continue;
      }
      const numberMatch = normalized.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
      if (numberMatch) {
        const value = Number(numberMatch[0]);
        if (!Number.isFinite(value)) throw new ValidationError('صيغة CALC تحتوي رقمًا غير منتهٍ.');
        tokens.push({ type: 'number', raw: numberMatch[0], value });
        index += numberMatch[0].length;
        continue;
      }
      if ('+-*/^()'.includes(normalized[index])) {
        tokens.push({ type: normalized[index] });
        index += 1;
        continue;
      }
      throw new ValidationError(`صيغة CALC تحتوي رمزًا غير مسموح: ${normalized[index]}.`);
    }
    if (tokens.length > 500) throw new ValidationError('صيغة CALC معقدة أكثر من الحد المسموح.');
    return tokens;
  }

  function evaluateArithmeticAst(node) {
    if (node.type === 'number') return node.value;
    if (node.type === 'unary') {
      const value = evaluateArithmeticAst(node.value);
      return node.operator === '-' ? -value : value;
    }
    const left = evaluateArithmeticAst(node.left);
    const right = evaluateArithmeticAst(node.right);
    let value;
    if (node.operator === '+') value = left + right;
    else if (node.operator === '-') value = left - right;
    else if (node.operator === '*') value = left * right;
    else if (node.operator === '/') {
      if (right === 0) throw new ValidationError('صيغة CALC تحتوي قسمة على صفر.');
      value = left / right;
    } else {
      if (Math.abs(right) > 100) throw new ValidationError('أس CALC خارج الحد الآمن من -100 إلى 100.');
      value = left ** right;
    }
    if (!Number.isFinite(value)) throw new ValidationError('ناتج صيغة CALC غير منتهٍ أو غير حقيقي.');
    return value;
  }

  function arithmeticAstToMathml(node) {
    if (node.type === 'number') return `<mn>${escapeXml(node.raw)}</mn>`;
    if (node.type === 'unary') return `<mrow><mo>${node.operator}</mo>${arithmeticAstToMathml(node.value)}</mrow>`;
    if (node.operator === '/') return `<mfrac>${arithmeticAstToMathml(node.left)}${arithmeticAstToMathml(node.right)}</mfrac>`;
    if (node.operator === '^') return `<msup>${arithmeticAstToMathml(node.left)}${arithmeticAstToMathml(node.right)}</msup>`;
    const operator = node.operator === '*' ? '×' : node.operator;
    return `<mrow>${arithmeticAstToMathml(node.left)}<mo>${operator}</mo>${arithmeticAstToMathml(node.right)}</mrow>`;
  }

  function parseArithmeticFormula(source) {
    const tokens = tokenizeArithmeticFormula(source);
    let position = 0;
    const peek = () => tokens[position];
    const take = (type) => {
      if (!peek() || peek().type !== type) throw new ValidationError(`صيغة CALC غير مكتملة؛ المتوقع ${type}.`);
      return tokens[position++];
    };
    let parseExpression;
    let parseUnary;

    function parsePrimary() {
      if (peek() && peek().type === 'number') {
        const token = take('number');
        return { type: 'number', raw: token.raw, value: token.value };
      }
      if (peek() && peek().type === '(') {
        take('(');
        const value = parseExpression();
        take(')');
        return value;
      }
      throw new ValidationError('صيغة CALC تحتوي موضعًا غير مكتمل.');
    }

    function parsePower() {
      let left = parsePrimary();
      if (peek() && peek().type === '^') {
        take('^');
        left = { type: 'binary', operator: '^', left, right: parseUnary() };
      }
      return left;
    }

    parseUnary = function parseUnaryFormula() {
      if (peek() && (peek().type === '+' || peek().type === '-')) {
        const operator = tokens[position++].type;
        return { type: 'unary', operator, value: parseUnary() };
      }
      return parsePower();
    };

    function parseTerm() {
      let left = parseUnary();
      while (peek() && (peek().type === '*' || peek().type === '/')) {
        const operator = tokens[position++].type;
        left = { type: 'binary', operator, left, right: parseUnary() };
      }
      return left;
    }

    parseExpression = function parseAdditive() {
      let left = parseTerm();
      while (peek() && (peek().type === '+' || peek().type === '-')) {
        const operator = tokens[position++].type;
        left = { type: 'binary', operator, left, right: parseTerm() };
      }
      return left;
    };

    const ast = parseExpression();
    if (position !== tokens.length) throw new ValidationError('صيغة CALC تحتوي رموزًا زائدة أو قوسًا غير متوازن.');
    const value = evaluateArithmeticAst(ast);
    return {
      ast,
      value,
      mathml: `<math dir="ltr" xmlns="http://www.w3.org/1998/Math/MathML">${arithmeticAstToMathml(ast)}</math>`,
    };
  }

  return Object.freeze({
    tokenizeArithmeticFormula,
    evaluateArithmeticAst,
    arithmeticAstToMathml,
    parseArithmeticFormula
  });
});
