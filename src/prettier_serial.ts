import { readFile, writeFile } from "atomically";
import process from "node:process";
import prettier from "prettier/standalone";
import prettierAcorn from "prettier/plugins/acorn";
import prettierAngular from "prettier/plugins/angular";
import prettierBabel from "prettier/plugins/babel";
import prettierEstree from "prettier/plugins/estree";
import prettierFlow from "prettier/plugins/flow";
import prettierGlimmer from "prettier/plugins/glimmer";
import prettierGraphql from "prettier/plugins/graphql";
import prettierHtml from "prettier/plugins/html";
import prettierMarkdown from "prettier/plugins/markdown";
import prettierMeriyah from "prettier/plugins/meriyah";
import prettierPostcss from "prettier/plugins/postcss";
import prettierTypescript from "prettier/plugins/typescript";
import prettierYaml from "prettier/plugins/yaml";
import { isNumber, resolve } from "./utils.js";
import type { ContextOptions, LazyFormatOptions } from "./types.js";

//TODO: Avoid loading plugins until they are actually needed

async function check(filePath: string, fileContent: string, formatOptions: LazyFormatOptions, contextOptions: ContextOptions): Promise<boolean> {
  const fileContentFormatted = await format(filePath, fileContent, formatOptions, contextOptions);
  return fileContent === fileContentFormatted;
}

async function checkWithPath(filePath: string, formatOptions: LazyFormatOptions, contextOptions: ContextOptions): Promise<boolean> {
  const fileContent = await readFile(filePath, "utf8");
  return check(filePath, fileContent, formatOptions, contextOptions);
}

async function format(filePath: string, fileContent: string, formatOptions: LazyFormatOptions, contextOptions: ContextOptions): Promise<string> {
  const plugins = [prettierAcorn, prettierAngular, prettierBabel, prettierEstree, prettierFlow, prettierGlimmer, prettierGraphql, prettierHtml, prettierMarkdown, prettierMeriyah, prettierPostcss, prettierTypescript, prettierYaml] // prettier-ignore
  if (isNumber(contextOptions.cursorOffset)) {
    const result = await prettier.formatWithCursor(fileContent, {
      ...(await resolve(formatOptions)),
      cursorOffset: contextOptions.cursorOffset,
      filepath: filePath,
      plugins,
    });
    process.stderr.write(`${result.cursorOffset}\n`); //TODO: This should be implemented differently, pretty ugly doing it like this
    return result.formatted;
  } else {
    return prettier.format(fileContent, {
      ...(await resolve(formatOptions)),
      rangeEnd: contextOptions.rangeEnd,
      rangeStart: contextOptions.rangeStart,
      filepath: filePath,
      plugins,
    });
  }
}

async function formatWithPath(filePath: string, formatOptions: LazyFormatOptions, contextOptions: ContextOptions): Promise<string> {
  const fileContent = await readFile(filePath, "utf8");
  return format(filePath, fileContent, formatOptions, contextOptions);
}

async function write(filePath: string, fileContent: string, formatOptions: LazyFormatOptions, contextOptions: ContextOptions): Promise<boolean> {
  const fileContentFormatted = await format(filePath, fileContent, formatOptions, contextOptions);
  if (fileContent === fileContentFormatted) return true;
  await writeFile(filePath, fileContentFormatted, "utf8");
  return false;
}

async function writeWithPath(filePath: string, formatOptions: LazyFormatOptions, contextOptions: ContextOptions): Promise<boolean> {
  const fileContent = await readFile(filePath, "utf8");
  return write(filePath, fileContent, formatOptions, contextOptions);
}

export { check, checkWithPath, format, formatWithPath, write, writeWithPath };
