import { describe, expect, it } from "vitest";
import { moduleFiles } from "./source-files.js";

const ALLOWED_FILES = /^src\/(main\.ts|cli\/[^/]+\.ts)$/;
const PARSER_CALL = /\b(parseConfig|parseCliConfig)\(\s*$/;

describe("R9.1: environment variables are read through the config parsers only", () => {
  it("uses process.env only in main.ts and src/cli, as the argument of parseConfig or parseCliConfig", () => {
    const offenders: string[] = [];
    for (const file of moduleFiles(".ts", "src")) {
      file.text.split("\n").forEach((line, index) => {
        let from = line.indexOf("process.env");
        while (from !== -1) {
          const asArgument =
            PARSER_CALL.test(line.slice(0, from)) && /^process\.env\s*[,)]/.test(line.slice(from));
          if (!ALLOWED_FILES.test(file.path) || !asArgument) {
            offenders.push(`${file.path}:${index + 1}`);
          }
          from = line.indexOf("process.env", from + 1);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
