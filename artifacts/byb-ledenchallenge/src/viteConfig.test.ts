import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import ts from 'typescript';

import { validatePublicAppUrl } from './vitePublicAppUrl.ts';

const productionPublicAppUrl = 'https://byb.ninnydooms.nl';

function getVitestPublicAppUrl(source: string): string | undefined {
  const sourceFile = ts.createSourceFile(
    'vitest.config.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const exportAssignment = sourceFile.statements.find(
    (statement): statement is ts.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  const configArgument =
    exportAssignment &&
    ts.isCallExpression(exportAssignment.expression) &&
    ts.isIdentifier(exportAssignment.expression.expression) &&
    exportAssignment.expression.expression.text === 'defineConfig'
      ? exportAssignment.expression.arguments[0]
      : undefined;

  if (!configArgument || !ts.isObjectLiteralExpression(configArgument)) {
    return undefined;
  }

  const defineProperty = configArgument.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      property.name.getText(sourceFile) === 'define',
  );

  if (!defineProperty || !ts.isObjectLiteralExpression(defineProperty.initializer)) {
    return undefined;
  }

  const publicAppUrlProperty = defineProperty.initializer.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      (ts.isStringLiteral(property.name) ||
        ts.isNoSubstitutionTemplateLiteral(property.name)) &&
      property.name.text === 'import.meta.env.VITE_PUBLIC_APP_URL',
  );
  const initializer = publicAppUrlProperty?.initializer;

  if (
    !initializer ||
    !ts.isCallExpression(initializer) ||
    !ts.isPropertyAccessExpression(initializer.expression) ||
    !ts.isIdentifier(initializer.expression.expression) ||
    initializer.expression.expression.text !== 'JSON' ||
    initializer.expression.name.text !== 'stringify'
  ) {
    return undefined;
  }

  const value = initializer.arguments[0];
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}

function assertSafeVitestPublicAppUrl(source: string): void {
  const configuredUrl = getVitestPublicAppUrl(source);

  assert.ok(configuredUrl, 'Vitest must define VITE_PUBLIC_APP_URL');
  assert.equal(
    new URL(configuredUrl).protocol,
    'https:',
    'Vitest VITE_PUBLIC_APP_URL must use HTTPS',
  );
  assert.notEqual(
    configuredUrl,
    productionPublicAppUrl,
    'Vitest VITE_PUBLIC_APP_URL must not use the production origin',
  );
  assert.equal(
    new URL(configuredUrl).hostname.endsWith('.test'),
    true,
    'Vitest VITE_PUBLIC_APP_URL must use a reserved .test hostname',
  );
}

function hasRequiredPublicAppUrlValidation(source: string): boolean {
  const sourceFile = ts.createSourceFile(
    'vite.config.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map<string, ts.FunctionLikeDeclaration>();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        ) {
          declarations.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }

  const exportAssignment = sourceFile.statements.find(
    (statement): statement is ts.ExportAssignment =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );

  if (
    !exportAssignment ||
    !ts.isCallExpression(exportAssignment.expression) ||
    !ts.isIdentifier(exportAssignment.expression.expression) ||
    exportAssignment.expression.expression.text !== 'defineConfig'
  ) {
    return false;
  }

  const configArgument = exportAssignment.expression.arguments[0];
  const configCallback =
    configArgument &&
    (ts.isArrowFunction(configArgument) ||
    ts.isFunctionExpression(configArgument) ||
    ts.isFunctionDeclaration(configArgument)
      ? configArgument
      : ts.isIdentifier(configArgument)
        ? declarations.get(configArgument.text)
        : undefined);

  if (!configCallback?.body || !ts.isBlock(configCallback.body)) {
    return false;
  }

  const validationIndex = configCallback.body.statements.findIndex((statement) => {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isCallExpression(statement.expression) ||
      !ts.isIdentifier(statement.expression.expression) ||
      statement.expression.expression.text !== 'validatePublicAppUrl' ||
      statement.expression.arguments.length !== 1
    ) {
      return false;
    }

    const argument = statement.expression.arguments[0];
    return (
      ts.isPropertyAccessExpression(argument) &&
      ts.isIdentifier(argument.expression) &&
      argument.expression.text === 'env' &&
      argument.name.text === 'VITE_PUBLIC_APP_URL'
    );
  });

  if (validationIndex < 0) {
    return false;
  }

  return !configCallback.body.statements
    .slice(0, validationIndex)
    .some((statement) => {
      let containsReturn = false;

      function visit(node: ts.Node): void {
        if (ts.isReturnStatement(node)) {
          containsReturn = true;
          return;
        }
        ts.forEachChild(node, visit);
      }

      visit(statement);
      return containsReturn;
    });
}

describe('Vitest public app URL configuration', () => {
  it('defines a reserved HTTPS origin instead of the production origin', () => {
    const vitestConfigSource = readFileSync(
      new URL('../vitest.config.ts', import.meta.url),
      'utf8',
    );

    assert.doesNotThrow(() => assertSafeVitestPublicAppUrl(vitestConfigSource));
  });

  it('rejects a missing or production test origin', () => {
    assert.throws(
      () => assertSafeVitestPublicAppUrl('export default defineConfig({});'),
      { message: 'Vitest must define VITE_PUBLIC_APP_URL' },
    );
    assert.throws(
      () =>
        assertSafeVitestPublicAppUrl(`
        export default defineConfig({
          define: {
            'import.meta.env.VITE_PUBLIC_APP_URL': JSON.stringify(
              '${productionPublicAppUrl}',
            ),
          },
        });
      `),
      { message: 'Vitest VITE_PUBLIC_APP_URL must not use the production origin' },
    );
  });
});

describe('Vite public deployment configuration', () => {
  it('validates the publication URL inside every configuration evaluation', () => {
    const viteConfigSource = readFileSync(
      new URL('../vite.config.ts', import.meta.url),
      'utf8',
    );

    assert.ok(
      hasRequiredPublicAppUrlValidation(viteConfigSource),
      'the defineConfig callback must validate env.VITE_PUBLIC_APP_URL on every evaluation',
    );
  });

  it('accepts a named and freely formatted configuration callback', () => {
    const source = `
      async function createConfig({ mode }: ConfigEnv) {
        const env = loadEnv(mode, import.meta.dirname, '');

        validatePublicAppUrl(
          env.VITE_PUBLIC_APP_URL,
        );

        return {};
      }

      export default defineConfig(createConfig);
    `;

    assert.equal(hasRequiredPublicAppUrlValidation(source), true);
  });

  it('rejects removed or conditional publication URL validation', () => {
    assert.equal(
      hasRequiredPublicAppUrlValidation(`
        const createConfig = async () => ({});
        export default defineConfig(createConfig);
      `),
      false,
    );
    assert.equal(
      hasRequiredPublicAppUrlValidation(`
        const createConfig = async () => {
          if (shouldValidate) {
            validatePublicAppUrl(env.VITE_PUBLIC_APP_URL);
          }
          return {};
        };
        export default defineConfig(createConfig);
      `),
      false,
    );
    assert.equal(
      hasRequiredPublicAppUrlValidation(`
        const createConfig = async () => {
          if (skipValidation) return {};
          validatePublicAppUrl(env.VITE_PUBLIC_APP_URL);
          return {};
        };
        export default defineConfig(createConfig);
      `),
      false,
    );
  });

  it('accepts the configured ByB Ledenchallenge publication domain', () => {
    assert.doesNotThrow(() => validatePublicAppUrl(productionPublicAppUrl));
  });

  it('rejects a different HTTPS publication domain with a clear error', () => {
    assert.throws(
      () => validatePublicAppUrl('https://ledenchallenge.example.nl'),
      {
        message:
          'VITE_PUBLIC_APP_URL points to "https://ledenchallenge.example.nl", but ByB Ledenchallenge is published at "https://byb.ninnydooms.nl". Update the deployment environment value before releasing.',
      },
    );
  });
});