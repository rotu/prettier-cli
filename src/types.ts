type FormatOptions = {
  experimentalTernaries?: boolean;
  arrowParens?: "avoid" | "always";
  bracketSameLine?: boolean;
  bracketSpacing?: boolean;
  embeddedLanguageFormatting?: "auto" | "off";
  endOfLine?: "lf" | "crlf" | "cr" | "auto";
  htmlWhitespaceSensitivity?: "css" | "strict" | "ignore";
  insertPragma?: boolean;
  jsxSingleQuote?: boolean;
  parser?: "flow" | "babel" | "babel-flow" | "babel-ts" | "typescript" | "acorn" | "espree" | "meriyah" | "css" | "less" | "scss" | "json" | "json5" | "json-stringify" | "graphql" | "markdown" | "mdx" | "vue" | "yaml" | "glimmer" | "html" | "angular" | "lwc"; // prettier-ignore
  printWidth?: number;
  proseWrap?: "always" | "never" | "preserve";
  quoteProps?: "as-needed" | "consistent" | "preserve";
  requirePragma?: boolean;
  semi?: boolean;
  singleAttributePerLine?: boolean;
  singleQuote?: boolean;
  tabWidth?: number;
  trailingComma?: "all" | "es5" | "none";
  useTabs?: boolean;
  vueIndentScriptAndStyle?: boolean;
};

type FunctionMaybe<T> = T | (() => T);

type Ignore = (filePath: string) => boolean;

type LazyFormatOptions = FunctionMaybe<PromiseMaybe<FormatOptions>>;

type LogLevel = "error" | "warn" | "log" | "debug" | "silent";

type Options = {
  /* INPUT OPTIONS */
  globs: string[];
  /* OUTPUT OPTIONS */
  check: boolean;
  list: boolean;
  write: boolean;
  /* CONFIG OPTIONS */
  config: boolean;
  editorConfig: boolean;
  /* OTHER OPTIONS */
  cache: boolean;
  cacheLocation: string | undefined;
  errorOnUnmatchedPattern: boolean;
  ignoreUnknown: boolean;
  logLevel: LogLevel;
  parallel: boolean;
  parallelWorkers: number;
  /* FORMAT OTIONS */
  formatOptions: FormatOptions;
};

type Prettier = typeof import("./prettier_serial.js");

type PrettierConfig = FormatOptions;

type PrettierConfigWithOverrides = PrettierConfig & {
  overrides?: {
    filesPositive: string[];
    filesNegative: string[];
    folder: string;
    options: PrettierConfig;
  }[];
};

type PromiseMaybe<T> = T | Promise<T>;

export type { FormatOptions, FunctionMaybe, Ignore, LazyFormatOptions, LogLevel, Options, Prettier, PrettierConfig, PrettierConfigWithOverrides, PromiseMaybe };
