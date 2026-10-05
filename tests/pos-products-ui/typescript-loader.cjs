const ts = require('../../next_app/node_modules/typescript')

module.exports = function typescriptLoader(source) {
  const result = ts.transpileModule(source, {
    fileName: this.resourcePath,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      sourceMap: false,
    },
  })
  const errors = (result.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error)
  if (errors.length) {
    throw new Error(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'))
  }
  return result.outputText
}
