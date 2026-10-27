import { writeFileSync } from "node:fs";
import { apis } from "../http/apis.js";
import { buildOpenApi } from "../http/openapi.js";

const OUTPUT = "docs/api/openapi.json";

writeFileSync(OUTPUT, `${JSON.stringify(buildOpenApi(apis), null, 2)}\n`);
console.log(`wrote ${OUTPUT}`);
