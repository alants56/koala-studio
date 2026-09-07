// Test-only loader: use the existing TypeScript dependency, with no generated files.
const ts = require('typescript')
const fs = require('node:fs')
require.extensions['.ts'] = function (module, filename) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  })
  module._compile(outputText, filename)
}
