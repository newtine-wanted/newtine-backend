import ts from 'typescript';

export default {
  process(sourceText, sourcePath) {
    const result = ts.transpileModule(sourceText, {
      fileName: sourcePath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        sourceMap: true,
        inlineSources: true,
        inlineSourceMap: false,
        // Keep type-only imports out of the runtime module graph. Several Nest
        // interfaces (for example ArgumentsHost) have no JavaScript export.
        verbatimModuleSyntax: false,
      },
      reportDiagnostics: false,
    });

    return {
      code: result.outputText,
      map: result.sourceMapText,
    };
  },
};
