#!/usr/bin/env bun
// Writes the settings search index from the rows the panes actually render.
// Run after changing a settings row: `bun scripts/settings-index.mjs`.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ROOT } from "./source-checks/files.mjs";

const WEB = path.join(ROOT, "apps/web/src");
const PAGE = path.join(WEB, "features/settings/components/settings-page.tsx");
export const INDEX_FILE = "apps/web/src/features/settings/settings-index.generated.ts";

// Rows that are a state the pane is in, not a setting.
export const NOT_SETTINGS = new Set([
  "Also in play here", "Could not read plugins", "Could not save", "Desktop app only", "Detecting", "Did not start", "Loading", "No hubs configured",
  "No other TeX install found", "No plugins registered", "Nothing on trial",
  "No update feed in this build", "None yet", "Not available here", "Pairing is off", "The engine did not answer",
]);

const parsed = new Map();
function parse(file) {
  if (!parsed.has(file)) parsed.set(file, ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return parsed.get(file);
}

function resolveModule(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(WEB, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return undefined;
  for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const tagName = (node) => (ts.isIdentifier(node.tagName) ? node.tagName.text : undefined);

function literal(expression) {
  if (!expression) return undefined;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isJsxExpression(expression)) return literal(expression.expression);
  return undefined;
}

function attributes(node) {
  const out = {};
  for (const attribute of node.attributes.properties) {
    if (ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name)) out[attribute.name.text] = attribute.initializer;
  }
  return out;
}

function stringList(initializer) {
  const expression = initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined;
  if (!expression || !ts.isArrayLiteralExpression(expression)) return undefined;
  return expression.elements.map(literal).filter((value) => value !== undefined);
}

/** Where an identifier used in `file` is defined: a function in the file, or an import followed to its file. */
function definitionOf(file, name, seen = new Set()) {
  const key = `${file}#${name}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const source = parse(file);
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return { file, node: statement };
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer) continue;
        const dynamicImport = dynamicTarget(declaration.initializer);
        if (dynamicImport) {
          const target = resolveModule(file, dynamicImport.spec);
          return target ? definitionOf(target, dynamicImport.name, seen) : undefined;
        }
        return { file, node: declaration.initializer };
      }
    }
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const element of statement.importClause.namedBindings.elements) {
        if (element.name.text !== name) continue;
        const target = resolveModule(file, statement.moduleSpecifier.text);
        return target ? definitionOf(target, (element.propertyName ?? element.name).text, seen) : undefined;
      }
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== name) continue;
        const target = resolveModule(file, statement.moduleSpecifier.text);
        return target ? definitionOf(target, (element.propertyName ?? element.name).text, seen) : undefined;
      }
    }
  }
  return undefined;
}

function dynamicTarget(initializer) {
  const text = initializer.getText();
  const match = /^dynamic\(\s*\(\)\s*=>\s*import\("([^"]+)"\)\.then\(\(mod\)\s*=>\s*mod\.(\w+)\)/.exec(text);
  return match ? { spec: match[1], name: match[2] } : undefined;
}

/** The title of the SettingsGroup a component draws its `children` inside, if it does. */
function childrenGroup(node) {
  let found;
  const visit = (current, group) => {
    if (found !== undefined) return;
    if (ts.isJsxElement(current) && tagName(current.openingElement) === "SettingsGroup") group = literal(attributes(current.openingElement).title) ?? group;
    if (group && ts.isJsxExpression(current) && current.expression && ts.isIdentifier(current.expression) && current.expression.text === "children") {
      found = group;
      return;
    }
    ts.forEachChild(current, (child) => visit(child, group));
  };
  visit(node, undefined);
  return found;
}

function textOf(expression, props) {
  const value = literal(expression);
  if (value !== undefined) return value;
  const inner = expression && ts.isJsxExpression(expression) ? expression.expression : undefined;
  if (inner && ts.isIdentifier(inner)) return props[inner.text];
  if (inner && ts.isPropertyAccessExpression(inner)) return props[inner.name.text];
  return undefined;
}

/** The objects of a module-level `const X = [{ label: "…", … }]`, as the props a `.map` over it hands each row. */
function arrayRows(file, name) {
  for (const statement of parse(file).statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) continue;
      return declaration.initializer.elements.filter(ts.isObjectLiteralExpression).map((element) =>
        Object.fromEntries(
          element.properties
            .filter((property) => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name))
            .map((property) => [property.name.text, literal(property.initializer) ?? (ts.isIdentifier(property.initializer) ? property.initializer.text : undefined)])
            .filter(([, value]) => value !== undefined),
        ),
      );
    }
  }
  return undefined;
}

/** Every fixed-label Row/ToggleRow reachable from `node`, with the SettingsGroup title around it. */
function collect(file, node, group, rows, visiting, props = {}) {
  const visit = (current, currentGroup) => {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
      const opening = ts.isJsxElement(current) ? current.openingElement : current;
      const name = tagName(opening);
      const attrs = attributes(opening);
      let nextGroup = currentGroup;
      if (name === "SettingsGroup") {
        nextGroup = literal(attrs.title) ?? currentGroup;
        const keywords = stringList(attrs.keywords);
        if (literal(attrs.title)) rows.push({ group: nextGroup, heading: true, ...(keywords?.length ? { keywords } : {}), loc: { file, pos: opening.getStart() } });
      }
      else if (name === "Row" || name === "ToggleRow") {
        const title = textOf(attrs.label, props);
        if (title && !NOT_SETTINGS.has(title)) {
          const hint = textOf(attrs.hint, props);
          const keywords = stringList(attrs.keywords);
          const id = literal(attrs.id);
          rows.push({ loc: { file, pos: opening.getStart() }, group: currentGroup, title, ...(hint ? { hint } : {}), ...(keywords?.length ? { keywords } : {}), ...(id ? { id } : {}) });
        }
      } else if (name && /^[A-Z]/.test(name)) {
        const definition = definitionOf(file, name);
        const key = definition && `${definition.file}:${definition.node.pos}`;
        if (definition && !visiting.has(key)) {
          visiting.add(key);
          const passed = Object.fromEntries(Object.entries(attrs).map(([prop, value]) => [prop, literal(value)]).filter(([, value]) => value !== undefined));
          collect(definition.file, definition.node, nextGroup, rows, visiting, passed);
          visiting.delete(key);
          const wrapped = childrenGroup(definition.node);
          if (wrapped && ts.isJsxElement(current)) {
            for (const child of current.children) visit(child, wrapped);
            return;
          }
        }
      }
      ts.forEachChild(current, (child) => visit(child, nextGroup));
      return;
    }
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) && current.expression.name.text === "map" && ts.isIdentifier(current.expression.expression)) {
      const items = arrayRows(file, current.expression.expression.text);
      const callback = current.arguments[0];
      if (items?.length && callback) {
        for (const item of items) collect(file, callback, currentGroup, rows, visiting, { ...props, ...item });
        return;
      }
    }
    ts.forEachChild(current, (child) => visit(child, currentGroup));
  };
  visit(node, group);
}

/** The JSX each `active === "<id>" && …` branch of the settings page renders. */
function sectionBranches() {
  const branches = [];
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const test = node.left;
      if (ts.isBinaryExpression(test) && test.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && ts.isIdentifier(test.left) && test.left.text === "active") {
        const id = literal(test.right);
        if (id) branches.push({ id, node: node.right });
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(PAGE));
  return branches;
}

export function collectSettingsPages() {
  const pages = [];
  for (const { id, node } of sectionBranches()) {
    const rows = [];
    collect(PAGE, node, undefined, rows, new Set());
    const seen = new Set();
    const groups = [];
    for (const row of rows) {
      let target = groups.find((candidate) => candidate.title === row.group);
      if (!target) groups.push((target = { ...(row.group ? { title: row.group } : {}), rows: [] }));
      if (row.heading) {
        if (row.keywords) target.keywords = [...new Set([...(target.keywords ?? []), ...row.keywords])];
        continue;
      }
      const key = `${row.group ?? ""}\u0000${row.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { group: _group, ...entry } = row;
      target.rows.push(entry);
    }
    pages.push({ id, groups });
  }
  return pages;
}

export function renderIndexModule(pages = collectSettingsPages()) {
  pages = pages.map((page) => ({ ...page, groups: page.groups.map((group) => ({ ...group, rows: group.rows.map(({ loc: _loc, ...row }) => row) })) }));
  const row = (entry) => `      ${JSON.stringify(entry)},`;
  const group = ({ rows, ...head }) => [`    { ${Object.keys(head).length ? `${JSON.stringify(head).slice(1, -1)}, ` : ""}rows: [`, ...rows.map(row), "    ] },"];
  const body = ["[", ...pages.flatMap(({ id, groups }) => [`  { id: ${JSON.stringify(id)}, groups: [`, ...groups.flatMap(group), "  ] },"]), "]"].join("\n");
  return [
    "// Generated by scripts/settings-index.mjs from the rows the panes render; do not edit.",
    'import type { SettingsGroupSpec } from "./search";',
    "",
    `export const GENERATED_PAGES: readonly { id: string; groups: readonly SettingsGroupSpec[] }[] = ${body};`,
    "",
  ].join("\n");
}

if (import.meta.main) {
  fs.writeFileSync(path.join(ROOT, INDEX_FILE), renderIndexModule());
  console.log(`wrote ${INDEX_FILE}`);
}
