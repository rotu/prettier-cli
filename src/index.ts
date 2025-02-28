import fs from "node:fs/promises";
import isBinaryPath from "is-binary-path";
import stringify from "json-sorted-stringify";
import path from "node:path";
import process from "node:process";
import Cache from "./cache.js";
import { getEditorConfigsMap, getEditorConfigResolved, getEditorConfigFormatOptions } from "./config_editorconfig.js";
import { getIgnoresContentMap, getIgnoreBys, getIgnoreResolved } from "./config_ignore.js";
import { Loaders, getPrettierConfigsMap, getPrettierConfigResolved } from "./config_prettier.js";
import { PRETTIER_VERSION, CLI_VERSION } from "./constants.js";
import Known from "./known.js";
import Logger from "./logger.js";
import { makePrettier } from "./prettier.js";
import { castArray, getExpandedFoldersPaths, getFoldersChildrenPaths, getPluginsVersions, getProjectPath, getStdin, getTargetsPaths } from "./utils.js";
import { fastRelativePath, isString, isUndefined, negate, pluralize, uniq } from "./utils.js";
import type { FormatOptions, Options, PluginsOptions } from "./types.js";

async function run(options: Options, pluginsDefaultOptions: PluginsOptions, pluginsCustomOptions: PluginsOptions): Promise<void> {
  const stdin = await getStdin();
  if (isString(stdin)) {
    return runStdin(options, pluginsDefaultOptions, pluginsCustomOptions);
  } else {
    return runGlobs(options, pluginsDefaultOptions, pluginsCustomOptions);
  }
}

async function runStdin(options: Options, pluginsDefaultOptions: PluginsOptions, pluginsCustomOptions: PluginsOptions): Promise<void> {
  const logger = new Logger(options.logLevel);
  const prettier = await import("./prettier_serial.js");

  const fileName = options.stdinFilepath || "stdin";
  const fileContent = (await getStdin()) || "";

  try {
    const formatted = await prettier.format(fileName, fileContent, options.formatOptions, options.contextOptions, pluginsDefaultOptions, pluginsCustomOptions);
    logger.always(formatted);
    process.exitCode = options.check && formatted !== fileContent ? 1 : 0;
  } catch (error) {
    logger.prefixed.error(String(error));
    process.exitCode = 1;
  }
}

async function runGlobs(options: Options, pluginsDefaultOptions: PluginsOptions, pluginsCustomOptions: PluginsOptions): Promise<void> {
  const logger = new Logger(options.logLevel);
  const spinner = options.check ? logger.spinner.log() : undefined;

  spinner?.start("Checking formatting...");

  const rootPath = process.cwd();
  const projectPath = getProjectPath(rootPath);
  const [filesPaths, filesNames, filesNamesToPaths, filesFoundPaths, foldersFoundPaths] = await getTargetsPaths(rootPath, options.globs, options.withNodeModules); // prettier-ignore
  const filesPathsTargets = filesPaths.filter(negate(isBinaryPath)).sort();
  const [foldersPathsTargets, foldersExtraPaths] = getExpandedFoldersPaths(foldersFoundPaths, projectPath);
  const filesExtraPaths = await getFoldersChildrenPaths([rootPath, ...foldersExtraPaths]);
  const filesExtraNames = filesExtraPaths.map((filePath) => path.basename(filePath));

  Known.addFilesPaths(filesFoundPaths);
  Known.addFilesPaths(filesExtraPaths);

  Known.addFilesNames(filesNames);
  Known.addFilesNames(filesExtraNames);

  const prettierVersion = PRETTIER_VERSION;
  const cliVersion = CLI_VERSION;
  const pluginsNames = options.formatOptions.plugins || [];
  const pluginsVersions = getPluginsVersions(pluginsNames);

  const editorConfigNames = [".editorconfig"].filter(Known.hasFileName);
  const ignoreNames = [".gitignore", ".prettierignore"].filter(Known.hasFileName);
  const prettierConfigNames = ["package.json", ".prettierrc", ".prettierrc.yml", ".prettierrc.yaml", ".prettierrc.json", ".prettierrc.jsonc", ".prettierrc.json5", ".prettierrc.js", "prettier.config.js", ".prettierrc.cjs", "prettier.config.cjs", ".prettierrc.mjs", "prettier.config.mjs"].filter(Known.hasFileName); // prettier-ignore

  const fileNames2parentPaths = (names: string[]) => names.flatMap((name) => filesNamesToPaths[name]?.map(path.dirname) || []);
  const editorConfigPaths = uniq([...fileNames2parentPaths(editorConfigNames), rootPath, ...foldersExtraPaths]);
  const ignorePaths = uniq([...fileNames2parentPaths(ignoreNames), rootPath, ...foldersExtraPaths]);
  const prettierConfigPaths = uniq([...fileNames2parentPaths(prettierConfigNames), rootPath, ...foldersExtraPaths]);

  const editorConfigs = options.editorConfig ? await getEditorConfigsMap(editorConfigPaths, editorConfigNames) : {};
  const ignoreContents = await getIgnoresContentMap(ignorePaths, ignoreNames);
  const prettierConfigs = options.config ? await getPrettierConfigsMap(prettierConfigPaths, prettierConfigNames) : {};

  const ignoreManualFilesNames = options.ignorePath || [];
  const ignoreManualFilesPaths = ignoreManualFilesNames.map((fileName) => path.resolve(fileName));
  const ignoreManualFilesContents = await Promise.all(ignoreManualFilesPaths.map((filePath) => fs.readFile(filePath, "utf8")));
  const ignoreManualFoldersPaths = ignoreManualFilesPaths.map(path.dirname);
  const ignoreManual = getIgnoreBys(ignoreManualFoldersPaths, ignoreManualFilesContents.map(castArray));

  const prettierManualFilesNames = options.configPath || [];
  const prettierManualFilesPaths = prettierManualFilesNames.map((fileName) => path.resolve(fileName));
  const prettierManualFilesContents = await Promise.all(prettierManualFilesPaths.map((filePath) => fs.readFile(filePath, "utf8")));
  const prettierManualConfigs = await Promise.all(prettierManualFilesPaths.map(Loaders.auto));
  const prettierManualConfig = prettierManualConfigs.length ? Object.assign({}, ...prettierManualConfigs) : undefined;

  const cliContextConfig = options.contextOptions;
  const cliFormatConfig = options.formatOptions;
  const cacheVersion = stringify({ prettierVersion, cliVersion, pluginsNames, pluginsVersions, editorConfigs, ignoreContents, prettierConfigs, ignoreManualFilesPaths, ignoreManualFilesContents, prettierManualFilesPaths, prettierManualFilesContents, cliContextConfig, cliFormatConfig, pluginsDefaultOptions, pluginsCustomOptions }); // prettier-ignore

  const shouldCache = isUndefined(cliContextConfig.cursorOffset);
  const cache = shouldCache ? new Cache(cacheVersion, projectPath, options, logger) : undefined;
  const prettier = await makePrettier(options, cache);

  //TODO: Maybe do work in chunks here, as keeping too many formatted files in memory can be a problem
  const filesResults = await Promise.allSettled(
    filesPathsTargets.map(async (filePath) => {
      const isIgnored = () => (ignoreManual ? ignoreManual(filePath) : getIgnoreResolved(filePath, ignoreNames));
      const isCacheable = () => cache?.has(filePath, isIgnored);
      const ignored = cache ? !(await isCacheable()) : await isIgnored();
      if (ignored) return;
      const getFormatOptions = async (): Promise<FormatOptions> => {
        const editorConfig = options.editorConfig ? getEditorConfigFormatOptions(await getEditorConfigResolved(filePath, editorConfigNames)) : {};
        const prettierConfig = prettierManualConfig || (options.config ? await getPrettierConfigResolved(filePath, prettierConfigNames) : {});
        const formatOptions = { ...editorConfig, ...prettierConfig, ...options.formatOptions };
        return formatOptions;
      };
      try {
        if (options.check || options.list) {
          return await prettier.checkWithPath(filePath, getFormatOptions, cliContextConfig, pluginsDefaultOptions, pluginsCustomOptions);
        } else if (options.write) {
          return await prettier.writeWithPath(filePath, getFormatOptions, cliContextConfig, pluginsDefaultOptions, pluginsCustomOptions);
        } else {
          return await prettier.formatWithPath(filePath, getFormatOptions, cliContextConfig, pluginsDefaultOptions, pluginsCustomOptions);
        }
      } finally {
        spinner?.update(fastRelativePath(rootPath, filePath));
      }
    }),
  );

  spinner?.stop("Checking formatting...");

  let totalMatched = filesResults.length;
  let totalIgnored = 0;
  let totalFormatted = 0;
  let totalUnformatted = 0;
  let totalUnknown = 0;
  let pathsUnknown: string[] = [];
  let totalErrored = 0;
  let pathsErrored: string[] = [];

  for (let i = 0, l = filesResults.length; i < l; i++) {
    const fileResult = filesResults[i];
    if (fileResult.status === "fulfilled") {
      if (isUndefined(fileResult.value)) {
        totalMatched -= 1;
        totalIgnored += 1;
      } else if (isString(fileResult.value)) {
        logger.always(fileResult.value);
      } else {
        if (fileResult.value) {
          totalFormatted += 1;
        } else {
          totalUnformatted += 1;
          const filePath = filesPathsTargets[i];
          const fileRelativePath = fastRelativePath(rootPath, filePath);
          if (options.check) {
            logger.prefixed.warn(fileRelativePath);
          } else if (options.list || options.write) {
            logger.warn(fileRelativePath);
          }
        }
      }
    } else {
      const error = fileResult.reason;
      if (error.name === "UndefinedParserError") {
        totalUnknown += 1;
        pathsUnknown.push(filesPathsTargets[i]);
      }
      if (error.name !== "UndefinedParserError" || !options.ignoreUnknown) {
        totalErrored += 1;
        pathsErrored.push(filesPathsTargets[i]);
        const filePath = filesPathsTargets[i];
        const fileRelativePath = fastRelativePath(rootPath, filePath);
        //TODO: Make sure the error is syntax-highlighted when possible
        if (options.check || options.write) {
          logger.prefixed.error(`${fileRelativePath}: ${error}`);
        } else if (options.list) {
          logger.error(fileRelativePath);
        }
      }
    }
  }

  logger.prefixed.debug(`Files found: ${totalMatched + totalIgnored}`);
  logger.prefixed.debug(`Files matched: ${totalMatched}`);
  logger.prefixed.debug(`Files ignored: ${totalIgnored}`);
  logger.prefixed.debug(`Files formatted: ${totalFormatted}`);
  logger.prefixed.debug(`Files unformatted: ${totalUnformatted}`);
  logger.prefixed.debug(`Files unknown: ${totalUnknown}`);
  logger.prefixed.debug(() => pathsUnknown.map((filePath) => fastRelativePath(rootPath, filePath)).join("\n"));
  logger.prefixed.debug(`Files errored: ${totalErrored}`);
  logger.prefixed.debug(() => pathsErrored.map((filePath) => fastRelativePath(rootPath, filePath)).join("\n"));

  if (!totalMatched) {
    if (options.errorOnUnmatchedPattern) {
      logger.prefixed.error(`No files matching the given patterns were found`);
    }
  }

  if (totalUnformatted) {
    if (options.check) {
      logger.prefixed.warn(`Code style issues found in ${totalUnformatted} ${pluralize("file", totalUnformatted)}. Run Prettier to fix.`);
    }
  }

  // if (totalErrored) {
  //   if (options.check) {
  //     logger.prefixed.error(`Parsing issues found in ${totalErrored} ${pluralize("file", totalErrored)}. Check files to fix.`);
  //   }
  // }

  if (!totalUnformatted && !totalErrored) {
    if (options.check) {
      logger.log("All matched files use Prettier code style!");
    }
  }

  cache?.write();

  process.exitCode = (!totalMatched && options.errorOnUnmatchedPattern) || totalErrored || (totalUnformatted && !options.write) ? 1 : 0;
}

export { run, runStdin, runGlobs };
