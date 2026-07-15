#!/usr/bin/env node
// ---------------------------------------------------------------------------
// scripts/build-cli.ts — Bundle `oaskills` into a Node-targeted ESM binary.
//
// Uses Bun's programmatic `build()` API to produce `dist/cli.mjs` from
// `src/cli/main.ts`, then prepends the `#!/usr/bin/env node` shebang and
// makes the output executable.
//
// Entrypoint: src/cli/main.ts
// Output:     dist/cli.mjs
// Target:     node
// Format:     esm
// External:   node:*
// ---------------------------------------------------------------------------

import { build, type Config } from "bun";
import { chmodSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

const ENTRY = new URL("../src/cli/main.ts", import.meta.url).pathname;
const OUTPUT = new URL("../dist/cli.mjs", import.meta.url).pathname;
const SHEBANG = "#!/usr/bin/env node\n";

const config: Config = {
  entrypoints: [ENTRY],
  outfile: OUTPUT,
  target: "node",
  format: "esm",
  external: ["node:*"],
};

const result = await build(config);

if (!result.success) {
  for (const msg of result.logs) {
    if (msg.position) {
      console.error(`${msg.position.file}:${msg.position.line}:${msg.position.column} — ${msg.message}`);
    } else {
      console.error(msg.message);
    }
  }
  process.exit(1);
}

// Prepend the shebang so the bundled file is directly executable.
// Bun's build output is plain JS without a shebang; we add it here.
const dir = dirname(OUTPUT);
mkdirSync(dir, { recursive: true });

// result.outputs[0] holds the primary output; read its text content.
const output = result.outputs[0];
if (!output) {
  console.error("build produced no outputs");
  process.exit(1);
}

const bundled = await output.text();
writeFileSync(OUTPUT, SHEBANG + bundled);

// Make it executable (POSIX only).
try {
  chmodSync(OUTPUT, 0o755);
} catch {
  // chmod may fail on Windows or in some sandboxed environments — non-fatal.
}

console.log(`✓ Built oaskills -> ${OUTPUT}`);
