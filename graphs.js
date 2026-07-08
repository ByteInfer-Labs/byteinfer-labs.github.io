/* Rune graph gallery: pick a transform, watch the graph change.
   Uses the whitepaper's before/after graph data + dagre layout + svg node classes.
   Shows graphs only — no DSL. Theme-aware (re-renders on light/dark toggle). */
(function () {
  "use strict";

  var GALLERY = {
    identity: {
      name: "Identity removal",
      note: "Every Identity node is removed and its consumers are rewired straight to its input — a no-op the runtime no longer has to execute.",
      before: {
        nodes: [
          {id:"x",label:"X",cls:"port"},{id:"id",op:"Identity",cls:"dead"},
          {id:"r",op:"Relu",cls:"base"},{id:"y",label:"Y",cls:"port"}
        ],
        edges: [{v:"x",w:"id"},{v:"id",w:"r",cls:"dead"},{v:"r",w:"y"}]
      },
      after: {
        nodes: [{id:"x",label:"X",cls:"port"},{id:"r",op:"Relu",cls:"base"},{id:"y",label:"Y",cls:"port"}],
        edges: [{v:"x",w:"r"},{v:"r",w:"y"}]
      }
    },
    bnfold: {
      name: "Conv + BatchNorm fold",
      note: "The BatchNorm's scale and shift are folded into the preceding convolution's weights, so the normalization layer disappears at no numerical cost.",
      before: {
        nodes: [
          {id:"x",label:"input",cls:"port"},{id:"conv",op:"Conv",cls:"base"},
          {id:"bn",op:"BatchNormalization",cls:"dead"},{id:"y",label:"out",cls:"port"}
        ],
        edges: [{v:"x",w:"conv"},{v:"conv",w:"bn",cls:"dead"},{v:"bn",w:"y",cls:"dead"}]
      },
      after: {
        nodes: [
          {id:"x",label:"input",cls:"port"},{id:"w",op:"W&#8242;, b&#8242;",label:"folded weights",cls:"new"},
          {id:"conv",op:"Conv",cls:"base"},{id:"y",label:"out",cls:"port"}
        ],
        edges: [{v:"x",w:"conv"},{v:"w",w:"conv",cls:"new"},{v:"conv",w:"y"}]
      }
    },
    layernorm: {
      name: "LayerNorm fusion",
      note: "A framework spells LayerNorm as thirteen primitive ops the runtime never fuses. They collapse into a single LayerNormalization operator.",
      before: {
        nodes: [
          {id:"x",label:"input",cls:"port"},{id:"g1",op:"mean &amp; variance",label:"5 ops",cls:"dead"},
          {id:"g2",op:"normalize",label:"4 ops",cls:"dead"},{id:"g3",op:"scale + shift",label:"4 ops",cls:"dead"},
          {id:"y",label:"out",cls:"port"}
        ],
        edges: [{v:"x",w:"g1",cls:"dead"},{v:"g1",w:"g2",cls:"dead"},{v:"g2",w:"g3",cls:"dead"},{v:"g3",w:"y",cls:"del"}]
      },
      after: {
        nodes: [
          {id:"x",label:"input",cls:"port"},{id:"ln",op:"LayerNormalization",label:"&#949;=1e-12",cls:"new"},
          {id:"y",label:"out",cls:"port"}
        ],
        edges: [{v:"x",w:"ln",cls:"new"},{v:"ln",w:"y",cls:"new"}]
      }
    },
    gqa: {
      name: "Attention → GroupQueryAttention",
      note: "A whole attention block — rotary embedding, KV-expansion, scores, softmax, roughly fifty ops — collapses into one fused GroupQueryAttention kernel.",
      before: {
        nodes: [
          {id:"x",label:"layernorm",cls:"port"},{id:"q",op:"MatMul",label:"q_proj",cls:"base"},
          {id:"k",op:"MatMul",label:"k_proj",cls:"base"},{id:"v",op:"MatMul",label:"v_proj",cls:"base"},
          {id:"rot",op:"rotary + KV expand",label:"~46 ops",cls:"dead"},
          {id:"sc",op:"scores + softmax",label:"6 ops",cls:"dead"},{id:"o",op:"MatMul",label:"o_proj",cls:"base"}
        ],
        edges: [
          {v:"x",w:"q"},{v:"x",w:"k"},{v:"x",w:"v"},
          {v:"q",w:"rot",cls:"dead"},{v:"k",w:"rot",cls:"dead"},{v:"v",w:"rot",cls:"dead"},
          {v:"rot",w:"sc",cls:"dead"},{v:"sc",w:"o",cls:"del"}
        ]
      },
      after: {
        nodes: [
          {id:"x",label:"layernorm",cls:"port"},{id:"q",op:"MatMul",label:"q_proj",cls:"base"},
          {id:"k",op:"MatMul",label:"k_proj",cls:"base"},{id:"v",op:"MatMul",label:"v_proj",cls:"base"},
          {id:"gqa",op:"GroupQueryAttention",label:"+ cache inits",cls:"new"},{id:"o",op:"MatMul",label:"o_proj",cls:"base"}
        ],
        edges: [
          {v:"x",w:"q"},{v:"x",w:"k"},{v:"x",w:"v"},
          {v:"q",w:"gqa",cls:"new"},{v:"k",w:"gqa",cls:"new"},{v:"v",w:"gqa",cls:"new"},{v:"gqa",w:"o",cls:"new"}
        ]
      }
    },
    lora: {
      name: "LoRA adapter inject",
      note: "A frozen projection is wrapped with a low-rank adapter. At initialization the adapter is zero, so the graph is numerically identical — then it trains in place.",
      before: {
        nodes: [
          {id:"x",label:"layernorm",cls:"port"},{id:"p",op:"MatMul",label:"q_proj",cls:"base"},
          {id:"r",op:"Reshape",cls:"base"},{id:"y",label:"out",cls:"port"}
        ],
        edges: [{v:"x",w:"p"},{v:"p",w:"r"},{v:"r",w:"y"}]
      },
      after: {
        nodes: [
          {id:"x",label:"layernorm",cls:"port"},{id:"p",op:"MatMul",label:"q_proj",cls:"base"},
          {id:"ma",op:"MatMul",label:"A",cls:"new"},{id:"mb",op:"MatMul",label:"B",cls:"new"},
          {id:"ls",op:"Mul",label:"&#215;&#945;/r",cls:"new"},{id:"lm",op:"Add",label:"merge",cls:"new"},
          {id:"r",op:"Reshape",cls:"base"},{id:"y",label:"out",cls:"port"}
        ],
        edges: [
          {v:"x",w:"p"},{v:"x",w:"ma",cls:"new"},{v:"ma",w:"mb",cls:"new"},{v:"mb",w:"ls",cls:"new"},
          {v:"ls",w:"lm",cls:"new"},{v:"p",w:"lm",cls:"new"},{v:"lm",w:"r",cls:"new"},{v:"r",w:"y"}
        ]
      }
    },
    qdq: {
      name: "INT8 quantization prep",
      note: "Quantize/dequantize pairs are inserted on every convolution's activation and weight edges, staging the model for INT8 execution.",
      before: {
        nodes: [{id:"x",label:"input",cls:"port"},{id:"conv",op:"Conv",cls:"base"},{id:"y",label:"out",cls:"port"}],
        edges: [{v:"x",w:"conv"},{v:"conv",w:"y"}]
      },
      after: {
        nodes: [
          {id:"x",label:"input",cls:"port"},{id:"aq",op:"Quantize",cls:"new"},{id:"adq",op:"Dequantize",cls:"new"},
          {id:"wdq",op:"Dequantize",label:"weight",cls:"new"},{id:"conv",op:"Conv",cls:"base"},{id:"y",label:"out",cls:"port"}
        ],
        edges: [
          {v:"x",w:"aq",cls:"new"},{v:"aq",w:"adq",cls:"new"},{v:"adq",w:"conv",cls:"new"},
          {v:"wdq",w:"conv",cls:"new"},{v:"conv",w:"y"}
        ]
      }
    }
  };
  var ORDER = ["identity", "bnfold", "layernorm", "gqa", "lora", "qdq"];

  var NS = "http://www.w3.org/2000/svg";
  var NCLS = {base:"node",dead:"node-dead","new":"node-new",port:"node-port",init:"node-init"};
  var TCLS = {dead:"t-dead","new":"t-new",port:"t-port"};
  var ECLS = {base:"e",dead:"e-dead","new":"e-new",del:"e-del"};
  var uid = 0;

  function getVar(name, fb) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fb;
  }
  function markerColor(ec) {
    if (ec === "e-new") return getVar("--accent", "#B4531A");
    if (ec === "e-del") return getVar("--del", "#A63A29");
    if (ec === "e-dead") return getVar("--edge-dead", "#bbb");
    return getVar("--edge", "#888");
  }
  function el(tag) { return document.createElementNS(NS, tag); }
  function tw(s, f) { return (s || "").replace(/&[^;]+;/g, "x").length * f; }

  function render(container, panel, dir) {
    if (!container) return;
    container.innerHTML = "";
    if (!panel || typeof dagre === "undefined") return;
    var id = "gg" + (uid++);
    var g = new dagre.graphlib.Graph();
    g.setGraph({rankdir: dir || "LR", nodesep: 12, ranksep: 30, marginx: 6, marginy: 8});
    g.setDefaultEdgeLabel(function () { return {}; });
    panel.nodes.forEach(function (n) {
      var op = n.op || "", lbl = n.label || "";
      var showLbl = op && lbl && lbl !== op && n.cls !== "port";
      var w, h;
      if (n.cls === "port") { w = Math.max(56, tw(lbl, 5.6) + 16); h = 20; }
      else { w = Math.max(52, Math.max(tw(op, 7.2), tw(lbl, 5.6)) + 16); h = showLbl ? 34 : 24; }
      g.setNode(n.id, {width: w, height: h, data: n, showLbl: showLbl});
    });
    panel.edges.forEach(function (e) { if (g.hasNode(e.v) && g.hasNode(e.w)) g.setEdge(e.v, e.w, {cls: e.cls || "base"}); });
    dagre.layout(g);
    var gw = Math.ceil(g.graph().width) + 12, gh = Math.ceil(g.graph().height) + 12;
    var svg = el("svg");
    svg.setAttribute("viewBox", "0 0 " + gw + " " + gh);
    svg.setAttribute("width", gw); svg.setAttribute("height", gh);
    svg.style.maxWidth = "100%"; svg.style.height = "auto";
    var defs = el("defs");
    ["base", "new", "del", "dead"].forEach(function (k) {
      var m = el("marker");
      m.setAttribute("id", "mk-" + k + "-" + id);
      m.setAttribute("viewBox", "0 0 8 8"); m.setAttribute("refX", "7"); m.setAttribute("refY", "4");
      m.setAttribute("markerWidth", "5.5"); m.setAttribute("markerHeight", "5.5");
      m.setAttribute("orient", "auto-start-reverse");
      var p = el("path"); p.setAttribute("d", "M0 0 L8 4 L0 8 z");
      p.setAttribute("fill", markerColor(ECLS[k])); m.appendChild(p); defs.appendChild(m);
    });
    svg.appendChild(defs);
    g.edges().forEach(function (eid) {
      var e = g.edge(eid), pts = e.points;
      var d = "M" + pts[0].x.toFixed(1) + " " + pts[0].y.toFixed(1);
      for (var i = 1; i < pts.length; i++) d += " L" + pts[i].x.toFixed(1) + " " + pts[i].y.toFixed(1);
      var path = el("path");
      path.setAttribute("class", ECLS[e.cls] || "e");
      path.setAttribute("d", d);
      path.setAttribute("marker-end", "url(#mk-" + (e.cls || "base") + "-" + id + ")");
      svg.appendChild(path);
    });
    g.nodes().forEach(function (nid) {
      var nd = g.node(nid), n = nd.data;
      var x = nd.x - nd.width / 2, y = nd.y - nd.height / 2;
      var rect = el("rect");
      rect.setAttribute("class", NCLS[n.cls] || "node");
      rect.setAttribute("x", x.toFixed(1)); rect.setAttribute("y", y.toFixed(1));
      rect.setAttribute("width", nd.width); rect.setAttribute("height", nd.height);
      rect.setAttribute("rx", n.cls === "port" ? 10 : 5);
      svg.appendChild(rect);
      var t = el("text");
      if (n.cls === "port") {
        t.setAttribute("class", "nm t-port"); t.setAttribute("y", (nd.y + 3).toFixed(1)); t.innerHTML = n.label;
      } else {
        t.setAttribute("class", ("op " + (TCLS[n.cls] || "")).trim());
        t.setAttribute("y", (nd.showLbl ? nd.y - 2 : nd.y + 3.5).toFixed(1)); t.innerHTML = n.op || n.label;
      }
      t.setAttribute("x", (x + 8).toFixed(1));
      svg.appendChild(t);
      if (nd.showLbl) {
        var t2 = el("text");
        t2.setAttribute("class", "nm " + (TCLS[n.cls] || ""));
        t2.setAttribute("x", (x + 8).toFixed(1)); t2.setAttribute("y", (nd.y + 11).toFixed(1));
        t2.innerHTML = n.label; svg.appendChild(t2);
      }
    });
    container.appendChild(svg);
  }

  function select(key) {
    var r = GALLERY[key], root = document.getElementById("graph-gallery");
    if (!r || !root) return;
    root.querySelectorAll(".rulebtn").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-g") === key);
    });
    render(document.getElementById("gg-before"), r.before, "LR");
    render(document.getElementById("gg-after"), r.after, "LR");
    document.getElementById("gg-note").innerHTML = r.note;
    root.setAttribute("data-active", key);
  }
  function init() {
    var root = document.getElementById("graph-gallery");
    if (!root) return;
    root.querySelectorAll(".rulebtn").forEach(function (b) {
      b.addEventListener("click", function () { select(b.getAttribute("data-g")); });
    });
    select("lora");
    var mo = new MutationObserver(function () {
      var k = root.getAttribute("data-active"); if (k) select(k);
    });
    mo.observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme", "class"]});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
