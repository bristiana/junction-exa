import { copyFile, mkdir } from "node:fs/promises";

const source = new URL("../shared/", import.meta.url);
const target = new URL("../extension/shared/", import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ["tokens.css", "components.css", "exa-uses.js"]) {
  await copyFile(new URL(file, source), new URL(file, target));
}
// web/ is served on its own, so it gets its own copy of the shared script.
await copyFile(new URL("exa-uses.js", source), new URL("../web/exa-uses.js", import.meta.url));
console.log("Shared files copied to extension/shared/ and web/");
