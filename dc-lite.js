/*
 * dc-lite — a tiny standalone runtime for the PinchPulse landing page.
 * Renders the Design Component templates (<template id="tpl-*">) with
 * {{holes}}, <sc-if>, <sc-for>, <dc-import>, on* handlers and ref callbacks.
 * Only changed values touch the DOM, so imperatively-set styles survive re-renders.
 */
(function () {
  'use strict';
  var HOLE = /\{\{\s*([\w$.]+)\s*\}\}/g;
  var ONE_HOLE = /^\s*\{\{\s*([\w$.]+)\s*\}\}\s*$/;
  var defs = {};

  function lookup(scope, path) {
    var parts = path.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) {
      var v = lookup(scope, p);
      return v == null ? '' : String(v);
    });
  }
  function raw(str, scope) {
    var m = ONE_HOLE.exec(str);
    return m ? lookup(scope, m[1]) : interp(str, scope);
  }
  function hasHole(s) { HOLE.lastIndex = 0; return s && s.indexOf('{{') !== -1; }

  // "a: b; c: {{x}}px" -> [[prop, valueTemplate]]
  function parseStyle(s) {
    var out = [], buf = '', depth = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (c === ';' && depth === 0) { out.push(buf); buf = ''; } else buf += c;
    }
    out.push(buf);
    return out.map(function (d) {
      var k = d.indexOf(':');
      if (k < 0) return null;
      return [d.slice(0, k).trim(), d.slice(k + 1).trim()];
    }).filter(function (x) { return x && x[0]; });
  }

  class DCLogic {
    constructor() { this.props = {}; this.state = {}; }
    setState(p) {
      var next = typeof p === 'function' ? p(this.state, this.props) : p;
      if (!next) return;
      this.state = Object.assign({}, this.state, next);
      if (this.__inst) this.__inst.schedule();
    }
    renderVals() { return {}; }
  }

  // Build DOM for a list of template nodes. Returns { nodes, update(scope), destroy() }.
  function buildList(tplNodes, ctx) {
    var parts = [];
    for (var i = 0; i < tplNodes.length; i++) {
      var p = buildNode(tplNodes[i], ctx);
      if (p) parts.push(p);
    }
    return {
      nodes: function () {
        var all = [];
        parts.forEach(function (p) { p.nodes().forEach(function (n) { all.push(n); }); });
        return all;
      },
      update: function (scope) { for (var i = 0; i < parts.length; i++) parts[i].update(scope); },
      destroy: function () { parts.forEach(function (p) { p.destroy(); }); }
    };
  }

  function insertAll(parent, nodes, before) {
    nodes.forEach(function (n) { parent.insertBefore(n, before); });
  }
  function removeAll(nodes) {
    nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
  }

  function buildNode(t, ctx) {
    if (t.nodeType === 3) {
      var txt = t.nodeValue;
      var tn = document.createTextNode(hasHole(txt) ? '' : txt);
      return {
        nodes: function () { return [tn]; },
        update: hasHole(txt) ? function (s) { var v = interp(txt, s); if (tn.nodeValue !== v) tn.nodeValue = v; } : function () {},
        destroy: function () {}
      };
    }
    if (t.nodeType !== 1) return null;
    var tag = t.localName;

    if (tag === 'sc-if') {
      var condT = t.getAttribute('value');
      var anchor = document.createComment('if');
      var kid = null, kidT = Array.prototype.slice.call(t.childNodes);
      return {
        nodes: function () { return kid ? kid.nodes().concat([anchor]) : [anchor]; },
        update: function (s) {
          var on = !!raw(condT, s);
          if (on && !kid) {
            kid = buildList(kidT, ctx);
            kid.update(s);
            if (anchor.parentNode) insertAll(anchor.parentNode, kid.nodes(), anchor);
          } else if (!on && kid) {
            removeAll(kid.nodes()); kid.destroy(); kid = null;
          } else if (kid) kid.update(s);
        },
        destroy: function () { if (kid) kid.destroy(); }
      };
    }

    if (tag === 'sc-for') {
      var listT = t.getAttribute('list'), as = t.getAttribute('as') || 'item';
      var anchorF = document.createComment('for');
      var rowT = Array.prototype.slice.call(t.childNodes);
      var rows = [];
      return {
        nodes: function () {
          var all = [];
          rows.forEach(function (r) { r.nodes().forEach(function (n) { all.push(n); }); });
          all.push(anchorF); return all;
        },
        update: function (s) {
          var list = raw(listT, s) || [];
          while (rows.length > list.length) { var r = rows.pop(); removeAll(r.nodes()); r.destroy(); }
          while (rows.length < list.length) {
            var nr = buildList(rowT, ctx);
            rows.push(nr);
            var sc0 = Object.create(s); sc0[as] = list[rows.length - 1]; sc0.index = rows.length - 1;
            nr.update(sc0);
            if (anchorF.parentNode) insertAll(anchorF.parentNode, nr.nodes(), anchorF);
          }
          for (var i = 0; i < rows.length; i++) {
            var sc = Object.create(s); sc[as] = list[i]; sc.index = i;
            rows[i].update(sc);
          }
        },
        destroy: function () { rows.forEach(function (r) { r.destroy(); }); }
      };
    }

    if (tag === 'dc-import') {
      var name = t.getAttribute('name');
      var attrs = Array.prototype.filter.call(t.attributes, function (a) {
        return a.name !== 'name' && a.name.indexOf('hint-') !== 0;
      });
      var child = null;
      var computeProps = function (s) {
        var p = {};
        attrs.forEach(function (a) {
          var key = a.name.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
          p[key] = raw(a.value, s);
        });
        return p;
      };
      var placeholder = document.createComment('import');
      return {
        nodes: function () { return child ? child.nodes() : [placeholder]; },
        update: function (s) {
          var p = computeProps(s);
          if (!child) {
            child = new Instance(defs[name], p);
            var parent = placeholder.parentNode;
            if (parent) { insertAll(parent, child.nodes(), placeholder); parent.removeChild(placeholder); child.mounted(); }
            else ctx.pendingMounts.push(child);
          } else child.setProps(p);
        },
        destroy: function () { if (child) child.destroy(); }
      };
    }

    // ordinary element: clone without children (keeps namespace + static attributes)
    var el = t.cloneNode(false);
    var binds = [];
    Array.prototype.slice.call(t.attributes).forEach(function (a) {
      var n = a.name, v = a.value;
      if (n === 'ref') {
        el.removeAttribute(n);
        var lastRef = null;
        binds.push(function (s) {
          var f = raw(v, s);
          if (f !== lastRef) { lastRef = f; if (typeof f === 'function') ctx.refs.push(function () { f(el); }); }
        });
        ctx.cleanups.push(function () { if (typeof lastRef === 'function') lastRef(null); });
        return;
      }
      if (n.length > 2 && n[0] === 'o' && n[1] === 'n' && ONE_HOLE.test(v)) {
        el.removeAttribute(n);
        var handler = null;
        el.addEventListener(n.slice(2).toLowerCase(), function (e) { if (typeof handler === 'function') return handler(e); });
        binds.push(function (s) { handler = raw(v, s); });
        return;
      }
      if (!hasHole(v)) return;
      if (n === 'style') {
        el.removeAttribute('style');
        var decls = parseStyle(v), last = {};
        decls.forEach(function (d) { if (!hasHole(d[1])) el.style.setProperty(d[0], d[1]); });
        var dyn = decls.filter(function (d) { return hasHole(d[1]); });
        binds.push(function (s) {
          for (var i = 0; i < dyn.length; i++) {
            var val = interp(dyn[i][1], s);
            if (last[dyn[i][0]] !== val) { last[dyn[i][0]] = val; el.style.setProperty(dyn[i][0], val); }
          }
        });
        return;
      }
      var lastA;
      binds.push(function (s) {
        var val = interp(v, s);
        if (val !== lastA) { lastA = val; el.setAttribute(n, val); }
      });
    });
    var kids = buildList(Array.prototype.slice.call(t.childNodes), ctx);
    var pend = ctx.pendingMounts;
    // children are appended after their first update (sc-if/for need a parent to insert into)
    var first = true;
    return {
      nodes: function () { return [el]; },
      update: function (s) {
        for (var i = 0; i < binds.length; i++) binds[i](s);
        if (first) {
          first = false;
          // attach anchors first so conditional children can insert before them
          kids.nodes().forEach(function (n) { el.appendChild(n); });
          kids.update(s);
          // imports created before their placeholder had a parent
          for (var j = pend.length - 1; j >= 0; j--) {
            var c = pend[j], ph = null;
            // placeholder already replaced when parent existed; here we just attach
            if (!c.attached) {
              var marks = Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 8 && n.nodeValue === 'import'; });
              if (marks.length) {
                ph = marks[0];
                insertAll(el, c.nodes(), ph); el.removeChild(ph);
                c.attached = true; pend.splice(j, 1); ctx.mountQueue.push(c);
              }
            }
          }
        } else kids.update(s);
      },
      destroy: function () { kids.destroy(); }
    };
  }

  function Instance(def, props) {
    var self = this;
    this.def = def;
    var logic = new def.Cls();
    logic.props = Object.assign({}, def.defaults, props || {});
    logic.state = logic.state || {};
    logic.__inst = this;
    this.logic = logic;
    this.ctx = { refs: [], cleanups: [], pendingMounts: [], mountQueue: [] };
    // wrap the template in a host-less list
    var tplNodes = Array.prototype.slice.call(def.tpl.content.childNodes);
    this.root = buildList(tplNodes, this.ctx);
    this.queued = false;
    this.render(true);
    this.schedule = function () {
      if (self.queued || self.dead) return;
      self.queued = true;
      Promise.resolve().then(function () { self.queued = false; if (!self.dead) self.render(false); });
    };
  }
  Instance.prototype.render = function (first) {
    var vals = this.logic.renderVals() || {};
    this.root.update(vals);
    this.flush();
  };
  Instance.prototype.flush = function () {
    var r = this.ctx.refs; this.ctx.refs = [];
    r.forEach(function (f) { f(); });
    var mq = this.ctx.mountQueue; this.ctx.mountQueue = [];
    mq.forEach(function (c) { c.mounted(); });
  };
  Instance.prototype.nodes = function () { return this.root.nodes(); };
  Instance.prototype.setProps = function (p) {
    var old = this.logic.props, changed = false;
    for (var k in p) if (old[k] !== p[k]) { changed = true; break; }
    if (!changed) return;
    this.logic.props = Object.assign({}, this.def.defaults, p);
    this.render(false);
  };
  Instance.prototype.mounted = function () {
    // hoisted top-level imports
    var pm = this.ctx.pendingMounts; this.ctx.pendingMounts = [];
    pm.forEach(function (c) { c.mounted(); });
    if (this.logic.componentDidMount) this.logic.componentDidMount();
  };
  Instance.prototype.destroy = function () {
    this.dead = true;
    if (this.logic.componentWillUnmount) this.logic.componentWillUnmount();
    this.ctx.cleanups.forEach(function (f) { f(); });
    this.root.destroy();
  };

  window.DCLogic = DCLogic;
  window.DC = {
    define: function (name, defaults, factory) {
      var tpl = document.getElementById('tpl-' + name);
      defs[name] = { name: name, tpl: tpl, defaults: defaults || {}, Cls: factory(DCLogic) };
    },
    mount: function (name, host) {
      var inst = new Instance(defs[name], {});
      inst.nodes().forEach(function (n) { host.appendChild(n); });
      inst.mounted();
      return inst;
    }
  };
})();
