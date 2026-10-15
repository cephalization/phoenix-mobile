import { defineRule } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

function isTestFrameworkObject(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
): expression is ESTree.IdentifierReference {
  if (expression.type !== "Identifier") return false;
  if (
    (expression.name === "vi" || expression.name === "jest") &&
    sourceCode.isGlobalReference(expression)
  ) {
    return true;
  }

  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length === 0) {
    return expression.name === "vi" || expression.name === "jest";
  }
  return variable.defs.some((definition) => {
    if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
      return false;
    }
    const source = definition.parent.source.value;
    const name = importedName(definition.node);
    return (source === "vitest" && name === "vi") || (source === "@jest/globals" && name === "jest");
  });
}

function mockedModuleName(node: ESTree.CallExpression): string | null {
  const [first] = node.arguments;
  if (first === undefined || first.type !== "Literal" || typeof first.value !== "string") {
    return null;
  }
  return first.value;
}

function allowedModules(option: unknown): ReadonlySet<string> {
  if (
    typeof option !== "object" ||
    option === null ||
    !("allowedModules" in option) ||
    !Array.isArray(option.allowedModules)
  ) {
    return new Set();
  }
  return new Set(option.allowedModules.filter((entry): entry is string => typeof entry === "string"));
}

function moduleMockCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  if (!("property" in callee) || !("object" in callee) || !("computed" in callee)) return false;
  if (!isTestFrameworkObject(sourceCode, callee.object)) return false;
  const property = callee.property;
  const method = callee.computed
    ? property.type === "Literal" &&
      (property.value === "doMock" ||
        property.value === "mock" ||
        property.value === "unstable_mockModule")
      ? property.value
      : null
    : property.type === "Identifier"
      ? property.name
      : null;
  return method !== null && moduleMockMethods.has(method);
}

/** Ban test framework module mocking in favor of real dependency seams. */
export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Vitest and Jest module mocking; tests must replace dependencies through real interfaces.",
    },
    messages: {
      moduleMock:
        "Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowedModules: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowedModules: [] }],
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (!moduleMockCall(context.sourceCode, node.callee)) return;
        // Local policy (phoenix-mobile): native platform modules with no Node implementation may be
        // mocked by exact specifier. Everything else still needs a real dependency seam.
        const mocked = mockedModuleName(node);
        if (mocked !== null && allowedModules(context.options?.[0]).has(mocked)) return;
        context.report({ node, messageId: "moduleMock" });
      },
    };
  },
});
