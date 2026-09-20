/* Tiny arithmetic expression evaluator.
   Templates carry answers/distractors as formula strings ("speed * hours"), so
   every option recomputes from the parameter set. No eval(), no Function(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.expr = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FNS = {
    abs: Math.abs, sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil,
    min: Math.min, max: Math.max, pow: Math.pow, sign: Math.sign,
    round: function (x, places) {
      var p = Math.pow(10, places === undefined ? 0 : places);
      // shift-and-round keeps 2.675 -> 2.68 instead of binary-float 2.67
      return Math.round((x * p).toPrecision(15)) / p;
    },
    gcd: function (a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a; },
    is_int: function (x) { return Math.abs(x - Math.round(x)) < 1e-9 ? 1 : 0; },
    divides: function (a, b) { return (b !== 0 && Math.abs(a % b) < 1e-9) ? 1 : 0; },
    lcm: function (a, b) { return Math.abs(a * b) / FNS.gcd(a, b); },
    hyp: function (a, b) { return Math.sqrt(a * a + b * b); }
  };
  var CONSTS = { pi: Math.PI, PI: Math.PI };

  function tokenize(src) {
    var toks = [], i = 0;
    while (i < src.length) {
      var c = src[i];
      if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
      if (/[0-9.]/.test(c)) {
        var j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
        var numText = src.slice(i, j);
        if (!/^\d+(\.\d+)?$|^\.\d+$/.test(numText)) throw new Error('bad number "' + numText + '"');
        toks.push({ t: 'num', v: parseFloat(numText) }); i = j; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        var k = i; while (k < src.length && /[A-Za-z0-9_]/.test(src[k])) k++;
        toks.push({ t: 'name', v: src.slice(i, k) }); i = k; continue;
      }
      var two = src.substr(i, 2);
      if (two === '<=' || two === '>=' || two === '==' || two === '!=' || two === '&&' || two === '||') {
        toks.push({ t: two }); i += 2; continue;
      }
      if ('+-*/%^(),<>'.indexOf(c) >= 0) { toks.push({ t: c }); i++; continue; }
      if (c === '!') { toks.push({ t: '!' }); i++; continue; }
      throw new Error('unexpected character "' + c + '" in expression');
    }
    return toks;
  }

  // precedence-climbing parser -> AST
  function parse(src) {
    var toks = tokenize(src), pos = 0;
    function peek() { return toks[pos]; }
    function eat(t) {
      var tok = toks[pos];
      if (!tok || tok.t !== t) throw new Error('expected "' + t + '" in "' + src + '"');
      pos++; return tok;
    }
    function primary() {
      var tok = peek();
      if (!tok) throw new Error('unexpected end of expression "' + src + '"');
      if (tok.t === 'num') { pos++; return { k: 'num', v: tok.v }; }
      if (tok.t === '-') { pos++; return { k: 'neg', a: unary() }; }
      if (tok.t === '!') { pos++; return { k: 'not', a: unary() }; }
      if (tok.t === '+') { pos++; return unary(); }
      if (tok.t === '(') { pos++; var e = expr(0); eat(')'); return e; }
      if (tok.t === 'name') {
        pos++;
        if (peek() && peek().t === '(') {
          pos++;
          var args = [];
          if (peek() && peek().t !== ')') {
            args.push(expr(0));
            while (peek() && peek().t === ',') { pos++; args.push(expr(0)); }
          }
          eat(')');
          return { k: 'call', name: tok.v, args: args };
        }
        return { k: 'var', name: tok.v };
      }
      throw new Error('unexpected token "' + tok.t + '" in "' + src + '"');
    }
    function unary() { return primary(); }
    var BIN = {
      '||': 1, '&&': 2,
      '<': 3, '>': 3, '<=': 3, '>=': 3, '==': 3, '!=': 3,
      '+': 4, '-': 4,
      '*': 5, '/': 5, '%': 5,
      '^': 6
    };
    function expr(minPrec) {
      var left = unary();
      while (true) {
        var tok = peek();
        if (!tok || !(tok.t in BIN) || BIN[tok.t] < minPrec) break;
        var op = tok.t, prec = BIN[op];
        pos++;
        // ^ is right-associative, the rest left-associative
        var right = expr(op === '^' ? prec : prec + 1);
        left = { k: 'bin', op: op, a: left, b: right };
      }
      return left;
    }
    var ast = expr(0);
    if (pos !== toks.length) throw new Error('trailing tokens in "' + src + '"');
    return ast;
  }

  var cache = Object.create(null);
  function compile(src) {
    if (!(src in cache)) cache[src] = parse(src);
    return cache[src];
  }

  function walk(node, scope) {
    switch (node.k) {
      case 'num': return node.v;
      case 'neg': return -walk(node.a, scope);
      case 'not': return walk(node.a, scope) ? 0 : 1;
      case 'var':
        if (scope && Object.prototype.hasOwnProperty.call(scope, node.name)) {
          var raw = scope[node.name];
          var n = typeof raw === 'number' ? raw : parseFloat(raw);
          if (typeof n !== 'number' || !isFinite(n)) {
            throw new Error('variable "' + node.name + '" is not numeric');
          }
          return n;
        }
        if (node.name in CONSTS) return CONSTS[node.name];
        throw new Error('unknown variable "' + node.name + '"');
      case 'call':
        if (!Object.prototype.hasOwnProperty.call(FNS, node.name)) {
          throw new Error('unknown function "' + node.name + '"');
        }
        return FNS[node.name].apply(null, node.args.map(function (a) { return walk(a, scope); }));
      case 'bin': {
        var x = walk(node.a, scope), y = walk(node.b, scope);
        switch (node.op) {
          case '+': return x + y;
          case '-': return x - y;
          case '*': return x * y;
          case '/':
            if (y === 0) throw new Error('division by zero');
            return x / y;
          case '%':
            if (y === 0) throw new Error('modulo by zero');
            return x % y;
          case '^': return Math.pow(x, y);
          // comparisons/logicals yield 1/0 so constraints are plain expressions
          case '<': return x < y ? 1 : 0;
          case '>': return x > y ? 1 : 0;
          case '<=': return x <= y ? 1 : 0;
          case '>=': return x >= y ? 1 : 0;
          case '==': return Math.abs(x - y) < 1e-9 ? 1 : 0;
          case '!=': return Math.abs(x - y) < 1e-9 ? 0 : 1;
          case '&&': return (x && y) ? 1 : 0;
          case '||': return (x || y) ? 1 : 0;
        }
      }
    }
    throw new Error('bad node');
  }

  function evaluate(src, scope) { return walk(compile(src), scope); }

  // Names an expression reads, so the validator can catch typos in params.
  function variables(src) {
    var out = [];
    (function rec(n) {
      if (n.k === 'var') { if (!(n.name in CONSTS) && out.indexOf(n.name) < 0) out.push(n.name); }
      else if (n.k === 'neg' || n.k === 'not') rec(n.a);
      else if (n.k === 'bin') { rec(n.a); rec(n.b); }
      else if (n.k === 'call') n.args.forEach(rec);
    })(compile(src));
    return out;
  }

  return { evaluate: evaluate, variables: variables, compile: compile, FNS: FNS };
});
