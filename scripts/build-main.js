const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const modules = [
  "js/constants",
  "js/view",
  "js/plugin",
  "js/plugin/state",
  "js/plugin/inline-status",
  "js/plugin/workspace",
  "js/plugin/inline-delegates",
  "js/plugin/inline-dom",
  "js/plugin/inline-refresh",
  "js/plugin/tasks",
  "js/plugin/markdown-block",
  "js/plugin/format",
  "js/plugin/block-ids",
  "js/plugin/editor-checkbox",
  "js/plugin/task-actions"
];

function modulePath(id) {
  return path.join(root, `${id}.js`);
}

function normalize(id) {
  return id.replace(/\\/g, "/").replace(/\.js$/, "");
}

function wrapper(id) {
  const source = fs.readFileSync(modulePath(id), "utf8");
  return `  ${JSON.stringify(id)}: function(module, exports, require) {\n${source.replace(/^/gm, "    ")}\n  }`;
}

const output = `"use strict";
// Generated from js/ by scripts/build-main.js. Edit js/*, then rebuild this file.
(function() {
  const __modules = {
${modules.map(wrapper).join(",\n")}
  };
  const __cache = {};

  function normalize(id) {
    return id.replace(/\\\\/g, "/").replace(/\\.js$/, "");
  }

  function __resolve(request, parentId) {
    if (request === "obsidian") return request;
    if (!request.startsWith(".")) return request;
    const base = parentId.slice(0, parentId.lastIndexOf("/"));
    const parts = (base + "/" + request).split("/");
    const stack = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return normalize(stack.join("/"));
  }

  function __require(id, parentId) {
    const resolved = __resolve(id, parentId || "");
    if (resolved === "obsidian") return require("obsidian");
    if (__cache[resolved]) return __cache[resolved].exports;
    const factory = __modules[resolved];
    if (!factory) throw new Error("Cannot find bundled module " + resolved);
    const module = { exports: {} };
    __cache[resolved] = module;
    factory(module, module.exports, (request) => __require(request, resolved));
    return module.exports;
  }

  module.exports = __require("./js/plugin");
})();
`;

fs.writeFileSync(path.join(root, "main.js"), output);
console.log(`Built main.js from ${modules.length} modules.`);
